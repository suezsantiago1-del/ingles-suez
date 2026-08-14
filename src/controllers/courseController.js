import dbPromise from '../config/database.js';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : ''
});

const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';

export const renderCourseDetail = async (req, res) => {
    const { id } = req.params;
    try {
        const db = await dbPromise;
        const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [id]);
        
        if (!curso) {
            return res.status(404).send('<h1>404 - Curso no encontrado</h1>');
        }

        let yaComprado = false;
        if (req.session.user) {
            const compra = await db.get(
                'SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?', 
                [req.session.user.id, id]
            );
            yaComprado = !!compra;
        }

        return res.render('course-detail', { curso, yaComprado });
    } catch (error) {
        console.error('Error al obtener el detalle del curso:', error);
        return res.redirect('/');
    }
};

export const processCheckout = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { id } = req.params;
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;
        const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [id]);

        if (!curso) {
            return res.status(404).send('Curso no encontrado');
        }

        // If current user is the course instructor, grant access immediately
        if (req.session.user && curso.instructor_email && req.session.user.email === curso.instructor_email) {
            const compraExistente = await db.get(
                'SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?',
                [usuarioId, curso.id]
            );
            if (!compraExistente) {
                await db.run(`INSERT INTO compras (usuario_id, curso_id) VALUES (?, ?)`,[usuarioId, curso.id]);
            }
            return res.redirect(`/classroom/${curso.id}`);
        }

        // For regular students, create a MercadoPago preference and redirect to payment
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        try {
            const preference = await Preference.create({
                items: [
                    {
                        title: curso.titulo,
                        quantity: 1,
                        unit_price: parseFloat(curso.precio) || 0
                    }
                ],
                back_urls: {
                    success: `${baseUrl}/payment/success?cursoId=${curso.id}`,
                    failure: `${baseUrl}/payment/failure`
                },
                external_reference: `${curso.id}:${usuarioId}`,
                auto_return: 'approved'
            });

            // Try multiple possible locations for init_point
            const initPoint = preference?.response?.init_point || preference?.body?.init_point || preference?.init_point;
            if (initPoint) {
                return res.redirect(initPoint);
            }
        } catch (mpErr) {
            console.error('MercadoPago error creating preference:', mpErr);
            // Fall back to showing course page with error
            return res.redirect(`/course/${id}`);
        }

        return res.redirect(`/course/${id}`);
    } catch (error) {
        console.error('Error al procesar la inscripción:', error);
        return res.redirect(`/course/${id}`);
    }
};

// Webhook handler for Mercado Pago notifications
export const handleMpWebhook = async (req, res) => {
    try {
        const mpAccessToken = process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : null;
        if (!mpAccessToken) {
            console.error('MP_ACCESS_TOKEN not configured for webhook processing');
            return res.status(500).send('MP not configured');
        }

        // Mercado Pago may send different payload shapes. Try common locations for the resource id.
        const body = req.body || {};
        let paymentId = null;

        if (body.data && body.data.id) paymentId = body.data.id;
        else if (body.id) paymentId = body.id;
        else if (body.resource && body.resource.id) paymentId = body.resource.id;

        if (!paymentId && req.query && req.query.id) paymentId = req.query.id;

        if (!paymentId) {
            console.warn('MercadoPago webhook received without payment id:', body);
            return res.status(400).send('No payment id');
        }

        // Fetch payment details from Mercado Pago
        const mpUrl = `https://api.mercadopago.com/v1/payments/${paymentId}`;
        const resp = await fetch(mpUrl, { headers: { Authorization: `Bearer ${mpAccessToken}` } });
        if (!resp.ok) {
            const txt = await resp.text();
            console.error('Error fetching MP payment:', resp.status, txt);
            return res.status(502).send('Error fetching payment');
        }

        const payment = await resp.json();
        console.log('MercadoPago payment fetched for webhook:', payment.id, payment.status);

        // Only act on approved payments
        if (payment.status && payment.status.toLowerCase() === 'approved') {
            // Try to read external_reference which we set when creating the preference
            const ext = payment.external_reference || (payment.order && payment.order.external_reference) || (payment.additional_info && payment.additional_info.items && payment.additional_info.items[0] && payment.additional_info.items[0].external_reference) || null;

            let courseId = null;
            let userId = null;

            if (ext && typeof ext === 'string' && ext.includes(':')) {
                const parts = ext.split(':');
                courseId = parts[0];
                userId = parts[1];
            }

            // As a fallback, try metadata/user_id or payer.email lookup
            const db = await dbPromise;

            if (!courseId || !userId) {
                // Try to infer courseId from payment.description or items
                if (payment.external_reference && typeof payment.external_reference === 'string' && payment.external_reference.includes(':')) {
                    const parts = payment.external_reference.split(':');
                    courseId = parts[0]; userId = parts[1];
                }
            }

            if (!courseId) {
                console.warn('Could not determine courseId from payment:', payment.id);
                // Still respond 200 to acknowledge webhook
                return res.status(200).send('Ignored');
            }

            // If we have no userId, try to match by payer email
            if (!userId && payment.payer && payment.payer.email) {
                const usuario = await db.get('SELECT id FROM usuarios WHERE email = ?', [payment.payer.email]);
                if (usuario) userId = usuario.id;
            }

            if (!userId) {
                console.warn('Could not determine userId for payment:', payment.id);
                return res.status(200).send('Ignored');
            }

            // Insert into compras if not exists
            const existe = await db.get('SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?', [userId, courseId]);
            if (!existe) {
                try {
                    await db.run('INSERT INTO compras (usuario_id, curso_id) VALUES (?, ?)', [userId, courseId]);
                    console.log(`Registered purchase for user ${userId} course ${courseId} from MP webhook`);
                } catch (e) {
                    console.error('Error inserting compra from webhook:', e);
                }
            } else {
                console.log('Compra already exists for user/course:', userId, courseId);
            }
        }

        // Acknowledge webhook
        return res.status(200).send('OK');
    } catch (err) {
        console.error('Error handling MP webhook:', err);
        return res.status(500).send('Server error');
    }
};

export const paymentSuccess = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { cursoId } = req.query;
    const usuarioId = req.session.user.id;

    try {
        if (cursoId) {
            const db = await dbPromise;
            const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [cursoId]);
            if (curso) {
                const compraExistente = await db.get(
                    'SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?',
                    [usuarioId, curso.id]
                );

                if (!compraExistente) {
                    await db.run(`
                        INSERT INTO compras (usuario_id, curso_id)
                        VALUES (?, ?)
                    `, [usuarioId, curso.id]);
                }
            }
        }
        return res.redirect('/mis-cursos');
    } catch (error) {
        console.error('Error al registrar la compra:', error);
        return res.redirect('/mis-cursos');
    }
};

export const paymentFailure = (req, res) => {
    return res.send(`
        <div style="text-align: center; font-family: sans-serif; margin-top: 4rem;">
            <h2>El pago no pudo completarse.</h2>
            <a href="/" style="color: #009ee3; font-weight: bold;">Volver al inicio</a>
        </div>
    `);
};

export const renderMyCourses = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    try {
        const db = await dbPromise;
        const cursosComprados = await db.all(`
            SELECT DISTINCT c.*, com.fecha as fecha_compra 
            FROM compras com
            JOIN cursos c ON com.curso_id = c.id
            WHERE com.usuario_id = ?
        `, [req.session.user.id]);

        return res.render('my-courses', { cursos: cursosComprados });
    } catch (error) {
        console.error('Error al obtener mis cursos:', error);
        return res.redirect('/');
    }
};

export const renderClassroom = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { cursoId } = req.params;
    const leccionId = req.query.leccion;
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;

        // Load course to determine instructor and validate access
        const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [cursoId]);
        if (!curso) return res.status(404).send('Curso no encontrado');

        // Allow the instructor (per-course) automatic access
        let compra = null;
        if (req.session.user && curso.instructor_email && req.session.user.email === curso.instructor_email) {
            compra = { id: 'instructor' };
        } else {
            compra = await db.get(
                'SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?',
                [usuarioId, cursoId]
            );
        }

        if (!compra) {
            return res.redirect(`/course/${cursoId}`);
        }
        const lecciones = await db.all('SELECT * FROM lecciones WHERE curso_id = ? ORDER BY orden ASC', [cursoId]);

        if (!lecciones || lecciones.length === 0) {
            return res.send('<h1>Este curso aún no tiene lecciones cargadas.</h1>');
        }

        const entregasAlumno = await db.all(`
            SELECT e.leccion_id, d.nota, e.id as entrega_id
            FROM entregas e
            LEFT JOIN devoluciones d ON d.entrega_id = e.id
            WHERE e.usuario_id = ? AND e.curso_id = ?
              AND e.id IN (
                  SELECT MAX(id) 
                  FROM entregas 
                  WHERE usuario_id = ? AND curso_id = ? 
                  GROUP BY leccion_id
              )
        `, [usuarioId, cursoId, usuarioId, cursoId]);

        const mapaEntregas = new Map();
        entregasAlumno.forEach(e => {
            mapaEntregas.set(e.leccion_id, e.nota);
        });

        const leccionesPreviasExamen = lecciones.filter(l => l.orden < 10);
        const todasPreviasAprobadas = leccionesPreviasExamen.length > 0 && leccionesPreviasExamen.every(l => {
            if (!mapaEntregas.has(l.id)) return false; 
            const nota = mapaEntregas.get(l.id);
            return nota !== null && nota !== undefined && parseInt(nota, 10) >= 6;
        });

        let leccionAnteriorEntregada = true;
        const leccionesConEstado = lecciones.map((leccion, index) => {
            const entregada = mapaEntregas.has(leccion.id);
            const nota = mapaEntregas.get(leccion.id);
            let desbloqueada = false;

            if (leccion.orden === 10) {
                desbloqueada = todasPreviasAprobadas;
            } else if (index === 0) {
                desbloqueada = true;
            } else {
                desbloqueada = leccionAnteriorEntregada;
            }

            leccionAnteriorEntregada = entregada;

            return {
                ...leccion,
                completada: entregada,
                nota: nota,
                desbloqueada
            };
        });

        let leccionActiva = leccionesConEstado[0];

        if (leccionId) {
            const encontrada = leccionesConEstado.find(l => l.id == leccionId);
            if (encontrada && encontrada.desbloqueada) {
                leccionActiva = encontrada;
            } else {
                const ultimasDesbloqueadas = leccionesConEstado.filter(l => l.desbloqueada);
                leccionActiva = ultimasDesbloqueadas[ultimasDesbloqueadas.length - 1];
            }
        }

        return res.render('classroom', { 
            curso, 
            lecciones: leccionesConEstado, 
            leccionActiva 
        });

    } catch (error) {
        console.error('Error al ingresar al aula virtual:', error);
        return res.redirect('/mis-cursos');
    }
};

export const guardarEntrega = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    const { cursoId, leccionId, contenido } = req.body;
    const usuarioId = req.session.user.id;

    if (!cursoId || !leccionId || !contenido || contenido.trim() === '') {
        return res.status(400).json({ success: false, message: 'Datos incompletos para procesar la entrega' });
    }

    try {
        const db = await dbPromise;

        const leccionActual = await db.get('SELECT orden FROM lecciones WHERE id = ?', [leccionId]);

        if (!leccionActual) {
            return res.status(404).json({ success: false, message: 'Lección no encontrada' });
        }

        if (leccionActual.orden === 10) {
            const leccionesPrevias = await db.all('SELECT id FROM lecciones WHERE curso_id = ? AND orden < 10', [cursoId]);
            
            for (const prev of leccionesPrevias) {
                const entregaPrev = await db.get(`
                    SELECT d.nota 
                    FROM entregas e
                    LEFT JOIN devoluciones d ON d.entrega_id = e.id
                    WHERE e.usuario_id = ? AND e.leccion_id = ?
                    ORDER BY e.id DESC LIMIT 1
                `, [usuarioId, prev.id]);

                if (!entregaPrev || entregaPrev.nota === null || parseInt(entregaPrev.nota, 10) < 6) {
                    return res.status(403).json({ 
                        success: false, 
                        message: 'Debes tener aprobadas las clases 1 a 9 para enviar el Proyecto Integrador.' 
                    });
                }
            }
        }

        const ultimaEntrega = await db.get(`
            SELECT d.nota 
            FROM entregas e
            LEFT JOIN devoluciones d ON d.entrega_id = e.id
            WHERE e.usuario_id = ? AND e.leccion_id = ?
            ORDER BY e.id DESC 
            LIMIT 1
        `, [usuarioId, leccionId]);

        if (ultimaEntrega && ultimaEntrega.nota !== null && parseInt(ultimaEntrega.nota, 10) >= 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Esta clase/proyecto ya se encuentra aprobado y no permite más envíos.' 
            });
        }

        await db.run(`
            INSERT INTO entregas (usuario_id, curso_id, leccion_id, contenido)
            VALUES (?, ?, ?, ?)
        `, [usuarioId, cursoId, leccionId, contenido.trim()]);

        return res.json({ success: true, message: 'Entrega guardada correctamente' });
    } catch (error) {
        console.error('Error al guardar la entrega del alumno:', error);
        return res.status(500).json({ success: false, message: 'Error interno al guardar la entrega' });
    }
};

export const renderPanelProfesor = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';

    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).send('<h1>403 - Acceso denegado: Solo el profesor puede ver esta sección.</h1>');
    }

    try {
        const db = await dbPromise;

        const entregas = await db.all(`
            SELECT 
                e.id,
                e.usuario_id,
                e.contenido,
                e.fecha,
                u.nombre AS usuario_nombre,
                u.email AS usuario_email,
                c.titulo AS curso_titulo,
                l.titulo AS leccion_titulo,
                d.mensaje AS devolucion_mensaje,
                d.nota AS devolucion_nota,
                d.fecha AS devolucion_fecha
            FROM entregas e
            JOIN usuarios u ON e.usuario_id = u.id
            JOIN cursos c ON e.curso_id = c.id
            JOIN lecciones l ON e.leccion_id = l.id
            LEFT JOIN devoluciones d ON d.entrega_id = e.id
            WHERE d.id IS NULL OR d.nota IS NULL
            ORDER BY e.fecha ASC
        `);

        // Also load lecciones for management (course + lesson info)
        const lecciones = await db.all(`
            SELECT l.id as leccion_id, l.titulo as leccion_titulo, l.curso_id, l.orden, l.video_url, c.titulo as curso_titulo
            FROM lecciones l
            JOIN cursos c ON l.curso_id = c.id
            ORDER BY c.id, l.orden ASC
        `);

        return res.render('teacher-panel', { entregas: entregas || [], lecciones: lecciones || [] });
    } catch (error) {
        console.error('Error al obtener las entregas:', error);
        return res.redirect('/');
    }
};

export const guardarDevolucion = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';
    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso no autorizado' });
    }

    const { entregaId, usuarioId, mensaje, nota } = req.body;

    if (!entregaId || !usuarioId || !mensaje || mensaje.trim() === '') {
        return res.status(400).json({ success: false, message: 'Faltan campos requeridos' });
    }

    const notaValor = (nota !== undefined && nota !== null && nota !== '') ? parseInt(nota, 10) : null;

    try {
        const db = await dbPromise;

        const devExistente = await db.get('SELECT id FROM devoluciones WHERE entrega_id = ?', [entregaId]);

        if (devExistente) {
            await db.run(`
                UPDATE devoluciones 
                SET mensaje = ?, nota = ?, fecha = CURRENT_TIMESTAMP, leida = FALSE
                WHERE entrega_id = ?
            `, [mensaje.trim(), notaValor, entregaId]);
        } else {
            await db.run(`
                INSERT INTO devoluciones (entrega_id, usuario_id, mensaje, nota)
                VALUES (?, ?, ?, ?)
            `, [entregaId, usuarioId, mensaje.trim(), notaValor]);
        }

        return res.json({ success: true, message: 'Devolución guardada correctamente' });
    } catch (error) {
        console.error('Error al guardar devolución:', error);
        return res.status(500).json({ success: false, message: 'Error en el servidor al guardar la devolución' });
    }
};

export const renderMensajesAlumno = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;

        const mensajes = await db.all(`
            SELECT 
                d.id,
                d.mensaje,
                d.nota,
                d.fecha,
                d.leida,
                l.titulo AS leccion_titulo,
                c.titulo AS curso_titulo,
                e.contenido AS entrega_alumno
            FROM devoluciones d
            JOIN entregas e ON d.entrega_id = e.id
            JOIN lecciones l ON e.leccion_id = l.id
            JOIN cursos c ON e.curso_id = c.id
            WHERE d.usuario_id = ?
            ORDER BY d.fecha DESC
        `, [usuarioId]);

        await db.run('UPDATE devoluciones SET leida = TRUE WHERE usuario_id = ?', [usuarioId]);

        return res.render('student-messages', { mensajes });
    } catch (error) {
        console.error('Error al obtener mensajes del alumno:', error);
        return res.redirect('/');
    }
};

// Generar y descargar el Certificado en PDF
export const descargarCertificado = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { cursoId } = req.params;
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;

        const leccion10 = await db.get('SELECT id FROM lecciones WHERE curso_id = ? AND orden = 10', [cursoId]);
        
        if (!leccion10) {
            return res.status(404).send('No se encontró la evaluación final.');
        }

        const devolucionExamen = await db.get(`
            SELECT d.nota, d.fecha 
            FROM entregas e
            JOIN devoluciones d ON d.entrega_id = e.id
            WHERE e.usuario_id = ? AND e.leccion_id = ? AND d.nota >= 6
            ORDER BY e.id DESC
            LIMIT 1
        `, [usuarioId, leccion10.id]);

        if (!devolucionExamen) {
            return res.status(403).send('<h1>Aún no has aprobado el examen final (Clase 10) para descargar este certificado.</h1>');
        }

        const usuario = await db.get('SELECT nombre FROM usuarios WHERE id = ?', [usuarioId]);

        const pdfPath = path.join(__dirname, '../../public/certificados/plantilla.pdf');
        
        if (!fs.existsSync(pdfPath)) {
            return res.status(500).send('Error: Plantilla de certificado no encontrada en el servidor.');
        }

        const existingPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // --- 1. TAPAR COMPLETO "[NOMBRE Y APELLIDO DEL ALUMNO]" ---
        firstPage.drawRectangle({
            x: 160,
            y: 280,
            width: 520,
            height: 32,
            color: rgb(1, 1, 1) // Blanco #ffffff
        });

        // --- 2. ESCRIBIR EL NOMBRE REAL DEL ALUMNO CENTRADO ---
        const nombreTexto = usuario.nombre.toUpperCase();
        const sizeNombre = 21;
        const widthNombre = fontBold.widthOfTextAtSize(nombreTexto, sizeNombre);

        firstPage.drawText(nombreTexto, {
            x: (firstPage.getWidth() - widthNombre) / 2,
            y: 288,
            size: sizeNombre,
            font: fontBold,
            color: rgb(0.04, 0.13, 0.22) // Azul #0b2238
        });

        // --- 3. RELLENAR DÍA Y MES SOBRE LAS LÍNEAS DE LA FECHA ---
        const fechaObj = new Date(devolucionExamen.fecha);
        const dia = fechaObj.getDate().toString();
        const mes = fechaObj.toLocaleDateString('es-AR', { month: 'long' }).toUpperCase();

        // Día (Alineado tras "Dado a los")
        firstPage.drawText(dia, {
            x: 333,
            y: 172,
            size: 11,
            font: fontBold,
            color: rgb(0.04, 0.13, 0.22)
        });

        // Mes (Alineado tras "del mes de")
        firstPage.drawText(mes, {
            x: 470,
            y: 172,
            size: 11,
            font: fontBold,
            color: rgb(0.04, 0.13, 0.22)
        });

        // --- 4. AGREGAR FIRMA DEL PROFESOR (firma.jpg) ---
        const firmaPath = path.join(__dirname, '../../public/certificados/firma.jpg');

        if (fs.existsSync(firmaPath)) {
            const firmaBytes = fs.readFileSync(firmaPath);
            const firmaImage = await pdfDoc.embedJpg(firmaBytes);

            firstPage.drawImage(firmaImage, {
                x: 637,
                y: 110,
                width: 95,
                height: 70
            });
        }

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Certificado_${usuario.nombre.replace(/\s+/g, '_')}.pdf"`);
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error generando certificado:', error);
        return res.status(500).send('Error interno al generar el certificado.');
    }
};

// ==========================================
// SECCIÓN: CLASES PARTICULARES
// ==========================================

/**
 * Renderiza la página de Clases Particulares para el alumno,
 * cargando el historial de sus consultas previas e incluyendo el hilo de mensajes interactivo.
 */
export const renderPrivateClasses = async (req, res) => {
    let misConsultas = [];
    if (req.session.user) {
        try {
            const db = await dbPromise;
            misConsultas = await db.all(`
                SELECT * FROM mensajes_particulares 
                WHERE usuario_id = ? 
                ORDER BY fecha_consulta DESC
            `, [req.session.user.id]);

            // Cargar el historial extendido del chat para cada consulta
            for (let c of misConsultas) {
                try {
                    c.mensajesChat = await db.all(`
                        SELECT * FROM chat_mensajes_particulares 
                        WHERE consulta_id = ? 
                        ORDER BY fecha ASC
                    `, [c.id]);
                } catch (err) {
                    c.mensajesChat = [];
                }
            }
        } catch (error) {
            console.error('Error al obtener consultas particulares del alumno:', error);
        }
    }
    return res.render('privateClasses', { misConsultas });
};

/**
 * Guarda la consulta/solicitud enviada por el alumno para Clases Particulares
 * e inserta el primer mensaje en el historial de chat interactivo.
 */
export const guardarConsultaParticulares = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Usuario no autenticado' });
    }

    const { modalidad, objetivo, mensaje } = req.body;
    const usuarioId = req.session.user.id;

    if (!modalidad || !objetivo || !mensaje || mensaje.trim() === '') {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
    }

    try {
        const db = await dbPromise;

        // 1. Guardar consulta principal y retornar el ID generado
        const result = await db.run(`
            INSERT INTO mensajes_particulares (usuario_id, modalidad, objetivo, mensaje_alumno)
            VALUES (?, ?, ?, ?)
            RETURNING id
        `, [usuarioId, modalidad, objetivo, mensaje.trim()]);

        const consultaId = result ? result.lastID : null;

        // 2. Registrar el mensaje inicial en el historial del chat
        if (consultaId) {
            try {
                await db.run(`
                    INSERT INTO chat_mensajes_particulares (consulta_id, usuario_id, emisor, mensaje)
                    VALUES (?, ?, 'ALUMNO', ?)
                `, [consultaId, usuarioId, mensaje.trim()]);
            } catch (e) {
                console.log('Error insertando mensaje inicial en el chat:', e.message);
            }
        }

        return res.json({ 
            success: true, 
            message: 'Tu consulta para clases particulares ha sido enviada con éxito.' 
        });
    } catch (error) {
        console.error('Error al guardar la consulta de clases particulares:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al procesar la solicitud.' 
        });
    }
};

/**
 * Permite al alumno enviar mensajes continuos dentro de una consulta activa
 */
export const enviarMensajeAlumnoChat = async (req, res) => {
    const { consultaId, mensaje } = req.body;
    const usuarioId = req.session?.user?.id;

    if (!usuarioId) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (!consultaId || !mensaje || !mensaje.trim()) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    try {
        const db = await dbPromise;

        await db.run(`
            INSERT INTO chat_mensajes_particulares (consulta_id, usuario_id, emisor, mensaje)
            VALUES (?, ?, 'ALUMNO', ?)
        `, [consultaId, usuarioId, mensaje.trim()]);

        return res.json({ success: true, message: 'Mensaje enviado correctamente.' });
    } catch (error) {
        console.error('Error al guardar mensaje en el chat:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor al procesar el mensaje.' });
    }
};

/**
 * Renderiza el panel de gestión de Clases Particulares para el Profesor
 */
export const renderPanelParticularesProfesor = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';

    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).send('<h1>403 - Acceso denegado: Solo el profesor puede ver esta sección.</h1>');
    }

    try {
        const db = await dbPromise;

        const consultas = await db.all(`
            SELECT 
                mp.id,
                mp.usuario_id,
                mp.modalidad,
                mp.objetivo,
                mp.mensaje_alumno,
                mp.respuesta_profesor,
                mp.fecha_consulta,
                mp.fecha_respuesta,
                u.nombre AS usuario_nombre,
                u.email AS usuario_email
            FROM mensajes_particulares mp
            JOIN usuarios u ON mp.usuario_id = u.id
            ORDER BY mp.fecha_consulta DESC
        `);

        // Cargar el historial de chat para la vista del profesor
        for (let c of consultas) {
            try {
                c.mensajesChat = await db.all(`
                    SELECT * FROM chat_mensajes_particulares 
                    WHERE consulta_id = ? 
                    ORDER BY fecha ASC
                `, [c.id]);
            } catch (err) {
                c.mensajesChat = [];
            }
        }

        return res.render('teacher-particulares-panel', { consultas: consultas || [] });
    } catch (error) {
        console.error('Error al obtener consultas de clases particulares:', error);
        return res.redirect('/');
    }
};

/**
 * Guarda la respuesta del profesor a una consulta de Clase Particular
 */
export const guardarRespuestaParticular = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';
    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso no autorizado' });
    }

    const { consultaId, respuesta } = req.body;

    if (!consultaId || !respuesta || respuesta.trim() === '') {
        return res.status(400).json({ success: false, message: 'La respuesta no puede estar vacía.' });
    }

    try {
        const db = await dbPromise;

        const consulta = await db.get('SELECT usuario_id FROM mensajes_particulares WHERE id = ?', [consultaId]);
        if (!consulta) {
            return res.status(404).json({ success: false, message: 'Consulta no encontrada.' });
        }

        await db.run(`
            UPDATE mensajes_particulares
            SET respuesta_profesor = ?, fecha_respuesta = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [respuesta.trim(), consultaId]);

        try {
            await db.run(`
                INSERT INTO chat_mensajes_particulares (consulta_id, usuario_id, emisor, mensaje)
                VALUES (?, ?, 'PROFESOR', ?)
            `, [consultaId, consulta.usuario_id, respuesta.trim()]);
        } catch (e) {
            console.log('Error insertando en el chat del profesor:', e.message);
        }

        return res.json({ success: true, message: 'Respuesta guardada correctamente.' });
    } catch (error) {
        console.error('Error al guardar la respuesta del profesor:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
};

// Upload or set a video for a lesson (file upload or external URL)
export const uploadLessonVideo = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    const EMAIL_PROFESOR = 'suezsantiago1@gmail.com';
    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso no autorizado' });
    }

    try {
        const db = await dbPromise;

        const { leccionId, videoUrl } = req.body;

        if (!leccionId) {
            return res.status(400).json({ success: false, message: 'Falta el ID de la lección' });
        }

        let finalUrl = null;

        // If a file was uploaded (middleware should populate req.file)
        if (req.file && req.file.filename) {
            // Serve from /videos/ on the public folder
            finalUrl = `/videos/${req.file.filename}`;
        } else if (videoUrl && videoUrl.trim() !== '') {
            let candidate = videoUrl.trim();

            // Normalize YouTube watch/share links to embed form
            try {
                if (candidate.includes('youtube.com/watch')) {
                    const urlObj = new URL(candidate);
                    const v = urlObj.searchParams.get('v');
                    if (v) candidate = `https://www.youtube.com/embed/${v}`;
                } else if (candidate.includes('youtu.be/')) {
                    const parts = candidate.split('youtu.be/');
                    if (parts[1]) {
                        const id = parts[1].split(/[?&]/)[0];
                        candidate = `https://www.youtube.com/embed/${id}`;
                    }
                }
            } catch (e) {
                // ignore URL parsing errors and fall back to raw value
            }

            finalUrl = candidate;
        }

        if (!finalUrl) {
            return res.status(400).json({ success: false, message: 'No se proporcionó archivo ni URL de video' });
        }

        await db.run('UPDATE lecciones SET video_url = ? WHERE id = ?', [finalUrl, leccionId]);

        return res.json({ success: true, message: 'Video de la lección guardado correctamente', video_url: finalUrl });
    } catch (error) {
        console.error('Error al subir/guardar video de la lección:', error);
        return res.status(500).json({ success: false, message: 'Error interno al procesar el video' });
    }
};