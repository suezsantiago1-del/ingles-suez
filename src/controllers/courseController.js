import dbPromise from '../config/database.js';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.trim() : ''
});

// Email del profesor. Sobreescribible con la variable de entorno EMAIL_PROFESOR.
const EMAIL_PROFESOR = process.env.EMAIL_PROFESOR || 'suezsantiago1@gmail.com';

export const renderCourseDetail = async (req, res) => {
    const { id } = req.params;
    try {
        console.log('uploadLessonVideo: session user=', req.session && req.session.user ? req.session.user.email : null);
        console.log('uploadLessonVideo: req.body=', req.body);
        console.log('uploadLessonVideo: req.file=', req.file);
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
    const { codigo_descuento } = req.body;

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

        // Validar y aplicar código de descuento
        let precioFinal = curso.precio;
        let descuentoAplicado = null;

        if (codigo_descuento) {
            const codigo = await db.get(
                'SELECT * FROM codigos_descuento WHERE codigo = ? AND activo = TRUE',
                [codigo_descuento.toUpperCase()]
            );

            if (codigo) {
                if (codigo.usos_actuales >= codigo.usos_maximos) {
                    return res.json({ success: false, message: 'El código de descuento ha alcanzado su límite de usos.' });
                }

                precioFinal = Math.floor(curso.precio * (1 - codigo.porcentaje / 100));
                descuentoAplicado = {
                    codigo: codigo.codigo,
                    porcentaje: codigo.porcentaje,
                    precioOriginal: curso.precio,
                    precioFinal: precioFinal
                };
            } else {
                return res.json({ success: false, message: 'Código de descuento inválido.' });
            }
        }

        // For regular students, create a MercadoPago preference and redirect to payment
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        try {
            console.log('processCheckout: start - userId=', usuarioId, 'courseId=', curso.id);

            const prefClient = new Preference(client);
            const body = {
                items: [
                    {
                        title: curso.titulo,
                        quantity: 1,
                        unit_price: parseFloat(precioFinal) || 0
                    }
                ],
                back_urls: {
                    success: `${baseUrl}/payment/success?cursoId=${curso.id}`,
                    failure: `${baseUrl}/payment/failure`
                },
                external_reference: `${curso.id}:${usuarioId}`,
                auto_return: 'approved',
                metadata: {
                    codigo_descuento: descuentoAplicado ? descuentoAplicado.codigo : null
                }
            };

            console.log('processCheckout: creating MercadoPago preference with body:', JSON.stringify(body));
            const preference = await prefClient.create({ body });
            console.log('processCheckout: preference created:', JSON.stringify(preference));

            const initPoint = preference && (preference.init_point || preference.body?.init_point || preference?.response?.init_point);
            console.log('processCheckout: resolved initPoint=', initPoint);
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
                    
                    // Intentar incrementar contador de código de descuento si se usó uno
                    // Buscar en metadata del pago o en la preferencia
                    const metadata = payment.metadata || {};
                    const codigoUsado = metadata.codigo_descuento || null;
                    
                    if (codigoUsado) {
                        await db.run(
                            'UPDATE codigos_descuento SET usos_actuales = usos_actuales + 1 WHERE codigo = ?',
                            [codigoUsado.toUpperCase()]
                        );
                        console.log(`Código de descuento ${codigoUsado} incrementado para el pago ${payment.id}`);
                    }
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
    const { cursoId } = req.query;
    const usuarioId = req.session && req.session.user ? req.session.user.id : null;

    console.log('paymentSuccess: invoked. cursoId=', cursoId, 'sessionUserId=', usuarioId);

    if (!cursoId) {
        console.warn('paymentSuccess: no cursoId provided in query. Nothing to register.');
        return res.redirect('/mis-cursos');
    }

    if (!usuarioId) {
        // The user may not have returned in the same session; rely on webhook to record the purchase.
        console.warn('paymentSuccess: no logged-in user in session. Webhook should handle async registration.');
        return res.redirect('/mis-cursos');
    }

    try {
        const db = await dbPromise;
        const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [cursoId]);

        if (!curso) {
            console.error('paymentSuccess: curso not found for id=', cursoId);
            return res.redirect('/mis-cursos');
        }

        try {
            const compraExistente = await db.get('SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?', [usuarioId, curso.id]);
            if (!compraExistente) {
                const result = await db.run('INSERT INTO compras (usuario_id, curso_id) VALUES (?, ?)', [usuarioId, curso.id]);
                console.log('paymentSuccess: compra inserted result=', result);
            } else {
                console.log('paymentSuccess: compra already exists for user=', usuarioId, 'course=', curso.id);
            }
        } catch (sqlErr) {
            console.error('paymentSuccess: SQL error when inserting compra:', sqlErr);
        }

        return res.redirect('/mis-cursos');
    } catch (error) {
        console.error('paymentSuccess: unexpected error:', error);
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
            SELECT e.leccion_id, d.nota, e.id as entrega_id, e.teacher_notes
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
            mapaEntregas.set(e.leccion_id, { nota: e.nota, entrega_id: e.entrega_id, teacher_notes: e.teacher_notes });
        });

        const leccionesPreviasExamen = lecciones.filter(l => l.orden > 0 && l.orden < 10);
        const todasPreviasAprobadas = leccionesPreviasExamen.length > 0 && leccionesPreviasExamen.every(l => {
            if (!mapaEntregas.has(l.id)) return false;
            const entregaInfo = mapaEntregas.get(l.id) || {};
            const notaVal = entregaInfo.nota;
            return notaVal !== null && notaVal !== undefined && parseInt(notaVal, 10) >= 7;
        });

        let leccionAnteriorEntregada = true;
        const leccionesConEstado = lecciones.map((leccion, index) => {
            const entregada = mapaEntregas.has(leccion.id);
            const entregaInfo = mapaEntregas.get(leccion.id) || {};
            const nota = entregaInfo.nota;
            const teacher_notes = entregaInfo.teacher_notes || null;
            let desbloqueada = false;

            if (leccion.orden === 0) {
                // La lección de bienvenida siempre está desbloqueada y no bloquea la Clase 1.
                desbloqueada = true;
            } else if (leccion.orden === 10) {
                desbloqueada = todasPreviasAprobadas;
            } else if (index === 0) {
                desbloqueada = true;
            } else {
                desbloqueada = leccionAnteriorEntregada;
            }

            if (leccion.orden > 0) {
                leccionAnteriorEntregada = entregada;
            }

            return {
                ...leccion,
                completada: entregada,
                nota: nota,
                teacher_notes,
                teacher_note: leccion.teacher_note || null,
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
        } else {
            // Si no hay parámetro leccion, redirigir a la primera lección desbloqueada con el parámetro correcto
            const primeraDesbloqueada = leccionesConEstado.find(l => l.desbloqueada);
            if (primeraDesbloqueada) {
                console.log('Redirigiendo a primera lección desbloqueada:', primeraDesbloqueada.id);
                return res.redirect(`/classroom/${cursoId}?leccion=${primeraDesbloqueada.id}`);
            }
        }

        // Load announcements for this course
        const anuncios = await db.all('SELECT id, mensaje, created_at FROM curso_anuncios WHERE curso_id = ? ORDER BY created_at DESC', [cursoId]);

        // Consultas del alumno al profesor para la lección activa
        const consultas = (leccionActiva && leccionActiva.id)
            ? await db.all(
                'SELECT id, mensaje, respuesta_profesor, fecha, fecha_respuesta FROM consultas_leccion WHERE usuario_id = ? AND leccion_id = ? ORDER BY fecha ASC',
                [usuarioId, leccionActiva.id]
              )
            : [];

        // Debug: log active lesson and video URLs to help trace missing video issues
        try {
            const activeUrl = leccionActiva && leccionActiva.video_url;
            console.log('renderClassroom: leccionActiva id=', leccionActiva && leccionActiva.id, 'video_url=', activeUrl);
            console.log('renderClassroom: lecciones with video_url:', leccionesConEstado.map(l => ({ id: l.id, orden: l.orden, video_url: l.video_url })));

            // If the active lesson has a local-looking URL, check for file existence on disk.
            if (activeUrl && typeof activeUrl === 'string' && !activeUrl.startsWith('http')) {
                const candidates = [];
                // Candidate under public (e.g. /videos/xxx.mp4)
                try { candidates.push(path.join(__dirname, '../../public', activeUrl.replace(/^[\\/]+/, ''))); } catch(e){}
                // Candidate if exposed at /uploads -> map to project root + activeUrl
                try { candidates.push(path.join(process.cwd(), activeUrl.replace(/^[\\/]+/, ''))); } catch(e){}
                // Candidate directly using value if it's an absolute path
                try { candidates.push(activeUrl); } catch(e){}

                let found = false;
                for (const c of candidates) {
                    try {
                        if (c && fs.existsSync(c)) {
                            console.log('renderClassroom: video file exists on disk at:', c);
                            found = true;
                            break;
                        } else {
                            console.log('renderClassroom: video candidate not found:', c);
                        }
                    } catch (ex) {
                        console.warn('renderClassroom: error checking file candidate', c, ex && ex.stack ? ex.stack : ex);
                    }
                }

                if (!found) {
                    // Detect suspicious DB-stored absolute/temp paths
                    if (activeUrl.includes('tmp') || activeUrl.includes('temp') || /[A-Za-z]:[\\/]/.test(activeUrl) || activeUrl.startsWith('/tmp') ) {
                        console.warn('renderClassroom: video_url appears to be a temporary or absolute filesystem path. Consider storing a relative public URL (/videos/...) or using persistent storage. video_url=', activeUrl);
                    } else {
                        console.warn('renderClassroom: video_url does not map to an existing file on disk. video_url=', activeUrl);
                    }
                }
            }
        } catch (dbgErr) {
            console.error('renderClassroom: debug log error', dbgErr);
        }

        // Normalizar onclicks de checkAnswer (apóstrofes) para que los multiple
        // choice respondan al clic aunque el texto de explicación tenga comillas simples.
        if (leccionActiva && leccionActiva.contenido_html) {
            leccionActiva.contenido_html = normalizarCheckAnswers(leccionActiva.contenido_html);
            // Quitar los botones decorativos de "[ CAJA DE TEXTO / BOTÓN SUBIR AUDIO ]"
            leccionActiva.contenido_html = quitarBotonCajaDeTexto(leccionActiva.contenido_html);
            // Agregar opciones de traducción a la Fase 2 de las clases 6-9 si faltan
            leccionActiva.contenido_html = inyectarTraduccionFase2(leccionActiva.contenido_html, leccionActiva.orden);
        }

        return res.render('classroom', { 
            curso, 
            lecciones: leccionesConEstado, 
            leccionActiva,
            anuncios: anuncios || [],
            consultas: consultas || []
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
            const leccionesPrevias = await db.all('SELECT id FROM lecciones WHERE curso_id = ? AND orden > 0 AND orden < 10', [cursoId]);
            
            for (const prev of leccionesPrevias) {
                const entregaPrev = await db.get(`
                    SELECT d.nota 
                    FROM entregas e
                    LEFT JOIN devoluciones d ON d.entrega_id = e.id
                    WHERE e.usuario_id = ? AND e.leccion_id = ?
                    ORDER BY e.id DESC LIMIT 1
                `, [usuarioId, prev.id]);

                if (!entregaPrev || entregaPrev.nota === null || parseInt(entregaPrev.nota, 10) < 7) {
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

        if (ultimaEntrega && ultimaEntrega.nota !== null && parseInt(ultimaEntrega.nota, 10) >= 7) {
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


    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).send('<h1>403 - Acceso denegado: Solo el profesor puede ver esta sección.</h1>');
    }

    try {
        const db = await dbPromise;

        const entregas = await db.all(`
            SELECT 
                e.id,
                e.usuario_id,
                e.teacher_notes,
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
            SELECT l.id as leccion_id, l.titulo as leccion_titulo, l.curso_id, l.orden, l.video_url, l.teacher_note, c.titulo as curso_titulo
            FROM lecciones l
            JOIN cursos c ON l.curso_id = c.id
            ORDER BY c.id, l.orden ASC
        `);

        // Load course announcements
        const anuncios = await db.all(`SELECT id, curso_id, mensaje, created_at, updated_at FROM curso_anuncios ORDER BY created_at DESC`);

        // Consultas de alumnos al profesor, por lección
        const consultas = await db.all(`
            SELECT c.id, c.usuario_id, c.curso_id, c.leccion_id, c.mensaje, c.respuesta_profesor, c.fecha, c.fecha_respuesta,
                   u.nombre AS usuario_nombre, u.email AS usuario_email,
                   co.titulo AS curso_titulo, l.titulo AS leccion_titulo, l.orden
            FROM consultas_leccion c
            JOIN usuarios u ON c.usuario_id = u.id
            JOIN cursos co ON c.curso_id = co.id
            JOIN lecciones l ON c.leccion_id = l.id
            ORDER BY c.fecha ASC
        `);

        return res.render('teacher-panel', { entregas: entregas || [], lecciones: lecciones || [], anuncios: anuncios || [], consultas: consultas || [] });
    } catch (error) {
        console.error('Error al obtener las entregas:', error);
        return res.redirect('/');
    }
};

// Normaliza los onclick de checkAnswer en el contenido de una lección:
// re-escribe el 4º argumento (texto de explicación) escapando los apóstrofes,
// para que botones con 'Can't', &apos;, &amp;apos;, etc. no rompan el JS inline.
function normalizarCheckAnswers(html) {
    if (!html || !html.includes('checkAnswer')) return html;
    return html.replace(/onclick="checkAnswer\(([^"]*?)\)"/g, (m, inner) => {
        const re = /^\s*this\s*,\s*(true|false)\s*,\s*'([^']*)'\s*,\s*'([\s\S]*)'\s*$/;
        const mm = inner.match(re);
        if (!mm) return m;
        const texto = mm[3]
            .replace(/&amp;apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/'/g, "\\'");
        return `onclick="checkAnswer(this, ${mm[1]}, '${mm[2]}', '${texto}')"`;
    });
}

// Elimina los botones decorativos de "[ CAJA DE TEXTO / ... ]" del contenido
// (variantes: "BOTÓN SUBIR AUDIO", "EXTENSA / SUBIR DOCUMENTO", etc.).
// Son botones que no hacen nada dentro de las secciones de entregable.
function quitarBotonCajaDeTexto(html) {
    if (!html) return html;
    // Patrón genérico: <button ...>[ CAJA DE TEXTO [EXTENSA] / <cualquier texto> ]</button>
    return html.replace(/<button\b[^>]*>\s*\[\s*CAJA DE TEXTO[\s\S]*?\]\s*<\/button>/gi, '');
}

// Bloques de opciones de traducción para la Fase 2 (Parte II) de las clases 6-9.
// Se inyectan en el render si el diálogo existe pero aún no tiene las opciones (_trad),
// así se arregla el contenido ya guardado en la base sin migrar datos.
const BLOQUES_TRADUCCION = {
    6: `<div class="quiz-question" style="margin-top: 1.5rem;">
        <p><strong>¿Cuál es la traducción correcta para el diálogo completo?</strong></p>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c6_trad', 'El español de are you doing no es hacer, sino estar haciendo.')">( A ) ¿Qué hacés ahora? / Estoy cocinando la cena y mi hermano está viendo la tele.</button>
        <button class="option-btn" onclick="checkAnswer(this, true, 'c6_trad', 'Traducción correcta del presente continuo: What are you doing now = Qué estás haciendo ahora.')">( B ) ¿Qué estás haciendo ahora? / Estoy cocinando la cena y mi hermano está mirando la televisión.</button>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c6_trad', 'Contiene el auxiliar incorrecto para traducir la acción en curso.')">( C ) ¿Qué haces ahora? / Yo cocino la cena y mi hermano ve la televisión.</button>
        <div id="c6_trad" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
    </div>`,
    7: `<div class="quiz-question" style="margin-top: 1.5rem;">
        <p><strong>¿Cuál es la traducción correcta para el diálogo completo?</strong></p>
        <button class="option-btn" onclick="checkAnswer(this, true, 'c7_trad', 'Traducción correcta: can you use = ¿sabés usar?, can learn = puede aprender.')">( A ) ¿Podés usar este software de diseño? / No, no puedo usarlo, pero puedo aprender rápido.</button>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c7_trad', 'Could se usa para cortesía o pasado, no para capacidad presente.')">( B ) ¿Podrías usar este software de diseño? / No, no podría usarlo, pero podría aprender rápido.</button>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c7_trad', 'Omite el verbo modal can en la segunda parte de la respuesta.')">( C ) ¿Puedes usar este software de diseño? / No lo uso, pero aprendo rápido.</button>
        <div id="c7_trad" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
    </div>`,
    8: `<div class="quiz-question" style="margin-top: 1.5rem;">
        <p><strong>¿Cuál es la traducción correcta para el diálogo completo?</strong></p>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c8_trad', 'How much es para sustantivos incontables (café), y la negación lleva any.')">( A ) ¿Cuántos cafés tomás en la mañana? / Tomo muchos cafés, pero no les pongo azúcar.</button>
        <button class="option-btn" onclick="checkAnswer(this, true, 'c8_trad', 'Traducción correcta: how much coffee = cuánto café, any sugar = nada de azúcar.')">( B ) ¿Cuánto café tomás en la mañana? / Tomo mucho café, pero no le pongo azúcar.</button>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c8_trad', 'Change el sentido: la respuesta B no toma café en la mañana.')">( C ) ¿Cuánto café tomás en la mañana? / Tomo poco café, pero le pongo mucha azúcar.</button>
        <div id="c8_trad" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
    </div>`,
    9: `<div class="quiz-question" style="margin-top: 1.5rem;">
        <p><strong>¿Cuál es la traducción correcta para el diálogo completo?</strong></p>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c9_trad', 'Las comparaciones con adjetivos largos usan more + adjetivo, y el superlativo de the best.')">( A ) ¿Tu nuevo trabajo es más difícil que el anterior? / Sí, es más difícil, pero es el trabajo que tengo.</button>
        <button class="option-btn" onclick="checkAnswer(this, true, 'c9_trad', 'Traducción correcta: more difficult than = más difícil que, the best job = el mejor trabajo.')">( B ) ¿Tu nuevo trabajo es más difícil que el anterior? / Sí, es más difícil, pero es el mejor trabajo que tuve.</button>
        <button class="option-btn" onclick="checkAnswer(this, false, 'c9_trad', 'Coloca el comparativo en el lugar equivocado y cambia el superlativo.')">( C ) ¿Es tu trabajo nuevo difícil más que el anterior? / Sí, es más difícil, pero es el trabajo mejor que tenía.</button>
        <div id="c9_trad" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
    </div>`
};

// Inyecta el bloque de opciones de traducción (Fase 2, Parte II) para las clases 6-9
// si el diálogo ya está en el contenido y aún no tiene las opciones (_trad).
function inyectarTraduccionFase2(html, orden) {
    if (!html || !BLOQUES_TRADUCCION[orden] || html.includes('_trad')) return html;
    const bloque = BLOQUES_TRADUCCION[orden];
    // Inserta el bloque justo después del cierre del div del diálogo (después del último </div>)
    // Buscamos dónde termina el diálogo: el patrón del cierre del div de la Parte II.
    const idx = html.lastIndexOf('Persona B:</strong>');
    if (idx === -1) return html;
    const cierre = html.indexOf('</div>', idx);
    if (cierre === -1) return html;
    const insertAt = cierre + '</div>'.length;
    return html.slice(0, insertAt) + '\n' + bloque + html.slice(insertAt);
}

export const renderGestionCursos = async (req, res) => {
    if (!req.session.user || req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).send('<h1>403 - Acceso denegado: Solo el profesor puede ver esta sección.</h1>');
    }
    try {
        const db = await dbPromise;

        const lecciones = await db.all(`
            SELECT l.id as leccion_id, l.titulo as leccion_titulo, l.curso_id, l.orden, l.video_url, l.teacher_note, l.contenido_html, c.titulo as curso_titulo
            FROM lecciones l
            JOIN cursos c ON l.curso_id = c.id
            ORDER BY c.id, l.orden ASC
        `);

        const anuncios = await db.all(`SELECT id, curso_id, mensaje, created_at, updated_at FROM curso_anuncios ORDER BY created_at DESC`);

        return res.render('gestion-cursos', { lecciones: lecciones || [], anuncios: anuncios || [] });
    } catch (error) {
        console.error('Error al obtener gestión de cursos:', error);
        return res.redirect('/profesor/entregas');
    }
};

export const renderConsultasProfesor = async (req, res) => {
    if (!req.session.user || req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).send('<h1>403 - Acceso denegado: Solo el profesor puede ver esta sección.</h1>');
    }
    try {
        const db = await dbPromise;

        const consultas = await db.all(`
            SELECT c.id, c.usuario_id, c.curso_id, c.leccion_id, c.mensaje, c.respuesta_profesor, c.fecha, c.fecha_respuesta,
                   u.nombre AS usuario_nombre, u.email AS usuario_email,
                   co.titulo AS curso_titulo, l.titulo AS leccion_titulo, l.orden
            FROM consultas_leccion c
            JOIN usuarios u ON c.usuario_id = u.id
            JOIN cursos co ON c.curso_id = co.id
            JOIN lecciones l ON c.leccion_id = l.id
            ORDER BY c.fecha ASC
        `);

        return res.render('consultas-profesor', { consultas: consultas || [] });
    } catch (error) {
        console.error('Error al obtener consultas de alumnos:', error);
        return res.redirect('/profesor/entregas');
    }
};

export const guardarDevolucion = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

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

// Save or update a teacher note for a specific entrega
export const saveTeacherNote = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso no autorizado' });
    }

    const { entregaId, note } = req.body;
    if (!entregaId) return res.status(400).json({ success: false, message: 'Falta entregaId' });

    try {
        const db = await dbPromise;
        await db.run('UPDATE entregas SET teacher_notes = ? WHERE id = ?', [note || null, entregaId]);
        return res.json({ success: true, message: 'Nota del profesor guardada correctamente' });
    } catch (error) {
        console.error('Error guardando nota del profesor:', error);
        return res.status(500).json({ success: false, message: 'Error al guardar nota del profesor' });
    }
};

export const renderMensajesAlumno = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;

        const rows = await db.all(`
            SELECT 
                d.id AS devolucion_id,
                d.mensaje,
                d.nota,
                d.fecha,
                d.leida,
                l.id AS leccion_id,
                l.titulo AS leccion_titulo,
                c.id AS curso_id,
                c.titulo AS curso_titulo,
                e.contenido AS entrega_alumno
            FROM devoluciones d
            JOIN entregas e ON d.entrega_id = e.id
            JOIN lecciones l ON e.leccion_id = l.id
            JOIN cursos c ON e.curso_id = c.id
            WHERE d.usuario_id = ?
            ORDER BY c.titulo, l.orden, d.fecha DESC
        `, [usuarioId]);

        // Mark as read
        await db.run('UPDATE devoluciones SET leida = TRUE WHERE usuario_id = ?', [usuarioId]);

        // Group by course then by lesson
        const cursosMap = new Map();
        for (const r of rows) {
            const cursoId = r.curso_id;
            if (!cursosMap.has(cursoId)) {
                cursosMap.set(cursoId, { curso_id: cursoId, curso_titulo: r.curso_titulo, leccionesMap: new Map() });
            }

            const cursoEntry = cursosMap.get(cursoId);
            const leccionId = r.leccion_id;
            if (!cursoEntry.leccionesMap.has(leccionId)) {
                cursoEntry.leccionesMap.set(leccionId, { leccion_id: leccionId, leccion_titulo: r.leccion_titulo, mensajes: [] });
            }

            const leccionEntry = cursoEntry.leccionesMap.get(leccionId);
            leccionEntry.mensajes.push({
                devolucion_id: r.devolucion_id,
                mensaje: r.mensaje,
                nota: r.nota,
                fecha: r.fecha,
                leida: r.leida,
                entrega_alumno: r.entrega_alumno
            });
        }

        // Convert maps to arrays and tidy structure
        const cursos = Array.from(cursosMap.values()).map(c => ({
            curso_id: c.curso_id,
            curso_titulo: c.curso_titulo,
            lecciones: Array.from(c.leccionesMap.values())
        }));

        return res.render('student-messages', { cursos });
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
            WHERE e.usuario_id = ? AND e.leccion_id = ? AND d.nota >= 7
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
            x: 328,
            y: 172,
            size: 11,
            font: fontBold,
            color: rgb(0.04, 0.13, 0.22)
        });

        // Mes (Alineado tras "del mes de")
        firstPage.drawText(mes, {
            x: 455,
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

    // If the student has any prior consulta, switch to chat-only (show the most recent chat)
    let singleChatMode = false;
    let activeConsultaId = null;
    if (Array.isArray(misConsultas) && misConsultas.length > 0) {
        singleChatMode = true;
        activeConsultaId = misConsultas[0].id;
    }

    return res.render('privateClasses', { misConsultas, singleChatMode, activeConsultaId });
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

    if (req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso no autorizado' });
    }

    try {
        console.log('uploadLessonVideo: start. session user=', req.session && req.session.user ? req.session.user.email : null);
        console.log('uploadLessonVideo: headers.content-length=', req.headers && req.headers['content-length']);
        console.log('uploadLessonVideo: req.body=', req.body);
        console.log('uploadLessonVideo: req.file=', req.file);
        const db = await dbPromise;

        const { leccionId, videoUrl } = req.body;

        if (!leccionId) {
            return res.status(400).json({ success: false, message: 'Falta el ID de la lección' });
        }

        let finalUrl = null;

        // If a file was uploaded (middleware should populate req.file)
        if (req.file && req.file.filename) {
            // Verify the file was saved to disk
            const savedPath = req.file.path || path.join(__dirname, '../../public/videos', req.file.filename);
            const exists = fs.existsSync(savedPath);
            console.log('uploadLessonVideo: expected savedPath=', savedPath, 'exists=', exists);

            if (exists) {
                try {
                    const stats = fs.statSync(savedPath);
                    console.log('uploadLessonVideo: saved file stats:', { size: stats.size, mtime: stats.mtime });
                } catch (sErr) {
                    console.warn('uploadLessonVideo: could not stat saved file', sErr);
                }

                try {
                    const dir = path.dirname(savedPath);
                    const files = fs.readdirSync(dir).slice(-20);
                    console.log('uploadLessonVideo: recent files in upload dir:', files);
                } catch (rErr) {
                    console.warn('uploadLessonVideo: could not read upload dir', rErr);
                }
            }

            if (!exists) {
                // If multer didn't save where we expected, try using req.file.path
                if (req.file.path && fs.existsSync(req.file.path)) {
                    console.log('uploadLessonVideo: found file at req.file.path=', req.file.path);
                } else {
                    console.error('uploadLessonVideo: uploaded file not found on disk. req.file:', req.file);
                    return res.status(500).json({ success: false, message: 'Archivo subido no encontrado en el servidor' });
                }
            }

            // Determine URL base for served uploads. If we store under public/, use that relative path.
            const uploadsPublicRoot = path.join(__dirname, '../../public');
            let urlBase = '/videos';
            try {
                const uploadsDirResolved = path.dirname(savedPath);
                if (uploadsDirResolved.startsWith(uploadsPublicRoot)) {
                    urlBase = '/' + path.relative(uploadsPublicRoot, uploadsDirResolved).replace(/\\/g, '/');
                } else {
                    // If uploads stored outside public, we expose them under /uploads via server.js
                    urlBase = '/uploads';
                }
            } catch (e) {
                console.warn('uploadLessonVideo: could not compute urlBase for uploads, defaulting to /videos', e);
                urlBase = '/videos';
            }

            finalUrl = `${urlBase}/${req.file.filename}`;
            console.log('uploadLessonVideo: computed finalUrl=', finalUrl);
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

        try {
            await db.run('UPDATE lecciones SET video_url = ? WHERE id = ?', [finalUrl, leccionId]);
            console.log('uploadLessonVideo: DB updated leccionId=', leccionId, 'with video_url=', finalUrl);
            return res.json({ success: true, message: 'Video de la lección guardado correctamente', video_url: finalUrl });
        } catch (dbErr) {
            console.error('uploadLessonVideo: error updating DB with video_url', dbErr);
            return res.status(500).json({ success: false, message: 'Error guardando la referencia del video en la base de datos' });
        }
    } catch (error) {
        // Log full stack for debugging upload-related failures (including Multer)
        console.error('Error al subir/guardar video de la lección:', error && error.stack ? error.stack : error);

        // If the error is a Multer error, return a clearer JSON status
        if (error && (error instanceof multer.MulterError || error.name === 'MulterError')) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ success: false, message: 'El archivo excede el tamaño máximo permitido' });
            }
            return res.status(400).json({ success: false, message: error.message || 'Error en la subida de archivo' });
        }

        // Generic fallback
        return res.status(500).json({ success: false, message: 'Error interno al procesar el video' });
    }
};

// Create or update a course announcement
export const createOrUpdateAnnouncement = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (req.session.user.email !== EMAIL_PROFESOR) return res.status(403).json({ success: false, message: 'Acceso no autorizado' });

    const { id, curso_id, mensaje } = req.body;
    if (!curso_id || !mensaje || mensaje.trim() === '') return res.status(400).json({ success: false, message: 'Faltan campos requeridos' });

    try {
        const db = await dbPromise;
        if (id) {
            await db.run('UPDATE curso_anuncios SET mensaje = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [mensaje.trim(), id]);
            return res.json({ success: true, message: 'Anuncio actualizado' });
        } else {
            const result = await db.run('INSERT INTO curso_anuncios (curso_id, mensaje) VALUES (?, ?) RETURNING id', [curso_id, mensaje.trim()]);
            return res.json({ success: true, message: 'Anuncio creado', id: result.lastID });
        }
    } catch (error) {
        console.error('Error creando/actualizando anuncio:', error);
        return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Delete a course announcement
export const deleteAnnouncement = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (req.session.user.email !== EMAIL_PROFESOR) return res.status(403).json({ success: false, message: 'Acceso no autorizado' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'Falta id del anuncio' });

    try {
        const db = await dbPromise;
        await db.run('DELETE FROM curso_anuncios WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Anuncio eliminado' });
    } catch (error) {
        console.error('Error eliminando anuncio:', error);
        return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

// Update per-lesson teacher note
export const updateLessonTeacherNote = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (req.session.user.email !== EMAIL_PROFESOR) return res.status(403).json({ success: false, message: 'Acceso no autorizado' });

    const { leccionId, note } = req.body;
    if (!leccionId) return res.status(400).json({ success: false, message: 'Falta leccionId' });

    try {
        const db = await dbPromise;
        await db.run('UPDATE lecciones SET teacher_note = ? WHERE id = ?', [note || null, leccionId]);
        return res.json({ success: true, message: 'Nota de la lección guardada correctamente' });
    } catch (error) {
        console.error('Error guardando nota de la lección:', error);
        return res.status(500).json({ success: false, message: 'Error al guardar nota de la lección' });
    }
};

export const actualizarContenidoLeccion = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (req.session.user.email !== EMAIL_PROFESOR) return res.status(403).json({ success: false, message: 'Acceso no autorizado' });

    const { leccionId, contenido } = req.body;
    if (!leccionId || contenido === undefined) return res.status(400).json({ success: false, message: 'Faltan datos' });

    try {
        const db = await dbPromise;
        await db.run('UPDATE lecciones SET contenido_html = ? WHERE id = ?', [String(contenido), leccionId]);
        return res.json({ success: true, message: 'Contenido de la lección actualizado' });
    } catch (error) {
        console.error('Error actualizando contenido de lección:', error);
        return res.status(500).json({ success: false, message: 'Error al actualizar el contenido' });
    }
};

export const eliminarNotaLeccion = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'No autenticado' });
    if (req.session.user.email !== EMAIL_PROFESOR) return res.status(403).json({ success: false, message: 'Acceso no autorizado' });

    const { leccionId } = req.body;
    if (!leccionId) return res.status(400).json({ success: false, message: 'Falta leccionId' });

    try {
        const db = await dbPromise;
        await db.run('UPDATE lecciones SET teacher_note = NULL WHERE id = ?', [leccionId]);
        return res.json({ success: true, message: 'Nota de la lección eliminada' });
    } catch (error) {
        console.error('Error eliminando nota de la lección:', error);
        return res.status(500).json({ success: false, message: 'Error al eliminar nota de la lección' });
    }
};

export const guardarConsultaLeccion = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const { cursoId, leccionId, mensaje } = req.body || {};
    if (!cursoId || !leccionId || !mensaje || !String(mensaje).trim()) {
        return res.status(400).json({ success: false, message: 'Faltan datos para la consulta' });
    }
    try {
        const db = await dbPromise;
        await db.run(
            'INSERT INTO consultas_leccion (usuario_id, curso_id, leccion_id, mensaje) VALUES (?, ?, ?, ?)',
            [req.session.user.id, parseInt(cursoId, 10), parseInt(leccionId, 10), String(mensaje).trim()]
        );
        return res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar consulta de lección:', error);
        return res.status(500).json({ success: false, message: 'Error al guardar la consulta' });
    }
};

export const responderConsultaLeccion = async (req, res) => {
    if (!req.session.user || req.session.user.email !== EMAIL_PROFESOR) {
        return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    const { consultaId, respuesta } = req.body || {};
    if (!consultaId || !respuesta || !String(respuesta).trim()) {
        return res.status(400).json({ success: false, message: 'Faltan datos para responder' });
    }
    try {
        const db = await dbPromise;
        await db.run(
            'UPDATE consultas_leccion SET respuesta_profesor = ?, fecha_respuesta = CURRENT_TIMESTAMP WHERE id = ?',
            [String(respuesta).trim(), parseInt(consultaId, 10)]
        );
        return res.json({ success: true });
    } catch (error) {
        console.error('Error al responder consulta de lección:', error);
        return res.status(500).json({ success: false, message: 'Error al responder la consulta' });
    }
};

export const renderMessagesList = async (req, res) => {
    if (!req.session.user) return res.redirect('/auth/login');
    const usuarioId = req.session.user.id;
    try {
        const db = await dbPromise;
        // List courses the student purchased
        const cursos = await db.all(`
            SELECT c.id, c.titulo
            FROM cursos c
            JOIN compras co ON co.curso_id = c.id
            WHERE co.usuario_id = ?
            ORDER BY c.titulo
        `, [usuarioId]);

        return res.render('messages-list', { cursos });
    } catch (error) {
        console.error('Error rendering messages list:', error);
        return res.redirect('/');
    }
};

export const marcarMensajesLeidos = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    try {
        const db = await dbPromise;
        await db.run('UPDATE devoluciones SET leida = TRUE WHERE usuario_id = ?', [req.session.user.id]);
        return res.json({ success: true });
    } catch (error) {
        console.error('Error al marcar mensajes como leídos:', error);
        return res.status(500).json({ success: false, message: 'Error al marcar como leídos' });
    }
};

export const renderMessagesCourse = async (req, res) => {
    if (!req.session.user) return res.redirect('/auth/login');
    const usuarioId = req.session.user.id;
    const cursoIdRaw = req.params.courseId;
    const cursoId = parseInt(cursoIdRaw, 10);
    const selectedLessonId = req.query.lessonId ? parseInt(req.query.lessonId, 10) : null;
    if (!cursoId || Number.isNaN(cursoId)) {
        console.error('renderMessagesCourse: invalid courseId param', { cursoIdRaw });
        return res.status(400).send('Invalid course id');
    }

    try {
        const db = await dbPromise;

        // Load course safely
        let course;
        try {
            course = await db.get('SELECT id, titulo FROM cursos WHERE id = ?', [cursoId]);
            if (!course) {
                console.error('renderMessagesCourse: course not found for id=', cursoId);
                return res.status(404).send('Curso no encontrado');
            }
        } catch (err) {
            console.error('renderMessagesCourse: error fetching course', err && err.stack ? err.stack : err);
            return res.render('student-messages-detail', {
                course: { id: cursoId, titulo: 'Curso (error)' },
                lessons: [],
                activeLessonId: null,
                messages: [],
                errorMessage: 'Error al cargar el curso'
            });
        }

        // Get first 10 lessons for the course (safe)
        let lessons = [];
        try {
            lessons = await db.all('SELECT id, titulo, orden FROM lecciones WHERE curso_id = ? ORDER BY orden LIMIT 10', [cursoId]) || [];
        } catch (err) {
            console.error('renderMessagesCourse: error fetching lessons', err && err.stack ? err.stack : err);
            lessons = [];
        }

        // Compute user's progress: max completed lesson order (safe)
        let row = null;
        try {
            row = await db.get(`
                SELECT MAX(l.orden) as maxOrden
                FROM entregas e
                JOIN lecciones l ON e.leccion_id = l.id
                WHERE e.usuario_id = ? AND e.curso_id = ?
            `, [usuarioId, cursoId]);
        } catch (err) {
            console.error('renderMessagesCourse: error fetching progress', err && err.stack ? err.stack : err);
            row = null;
        }
        const rawMax = row && (row.maxorden ?? row.maxOrden);
        const maxCompleted = rawMax ? parseInt(rawMax, 10) : 0;

        // Check if user has a purchase (full access) for this course (safe)
        let compra = null;
        try {
            compra = await db.get('SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?', [usuarioId, cursoId]);
        } catch (err) {
            console.error('renderMessagesCourse: error checking purchase', err && err.stack ? err.stack : err);
            compra = null;
        }
        const hasPurchase = !!compra;

        // Determine highest lesson order in the fetched lessons
        const maxLessonOrden = lessons.length ? Math.max(...lessons.map(x => parseInt(x.orden, 10))) : 0;

        // If the user purchased the course or has completed up to the last lesson, unlock all
        const unlockAll = hasPurchase || (maxCompleted >= maxLessonOrden);

        // Build lessons with isLocked flag (allow access up to maxCompleted + 1 when not unlocked)
        const lessonsWithLock = lessons.map(l => {
            const ordenNum = parseInt(l.orden, 10);
            const isLocked = !unlockAll && (ordenNum > (maxCompleted + 1));
            return {
                id: parseInt(l.id, 10),
                titulo: l.titulo,
                orden: ordenNum,
                isLocked
            };
        });

        // Debug logging for progress and lesson lock state
        console.log(`renderMessagesCourse: usuarioId=${usuarioId}, cursoId=${cursoId}, maxCompleted=${maxCompleted}, hasPurchase=${hasPurchase}, maxLessonOrden=${maxLessonOrden}, unlockAll=${unlockAll}`);
        lessonsWithLock.forEach(ll => console.log(`Lesson: id=${ll.id}, orden=${ll.orden}, isLocked=${ll.isLocked}`));

        // Determine active lesson
        let activeLessonId = selectedLessonId;
        if (!activeLessonId) {
            // pick first unlocked lesson
            const unlocked = lessonsWithLock.find(l => !l.isLocked);
            activeLessonId = unlocked ? unlocked.id : (lessonsWithLock[0] ? lessonsWithLock[0].id : null);
        }

        // Fetch messages/devoluciones for the active lesson (safe)
        let messages = [];
        const activeLessonIdNum = activeLessonId ? parseInt(activeLessonId, 10) : null;
        if (activeLessonIdNum) {
            try {
                messages = await db.all(`
                    SELECT d.id AS devolucion_id, d.mensaje, d.nota, d.fecha, e.contenido AS entrega_alumno
                    FROM devoluciones d
                    JOIN entregas e ON d.entrega_id = e.id
                    JOIN lecciones l ON e.leccion_id = l.id
                    WHERE e.usuario_id = ? AND e.curso_id = ? AND l.id = ?
                    ORDER BY d.fecha DESC
                `, [usuarioId, cursoId, activeLessonIdNum]) || [];
            } catch (err) {
                console.error('renderMessagesCourse: error fetching messages', err && err.stack ? err.stack : err);
                messages = [];
            }
        }

        try {
            return res.render('student-messages-detail', {
                course,
                lessons: lessonsWithLock,
                activeLessonId: activeLessonIdNum,
                messages
            });
        } catch (renderErr) {
            console.error('renderMessagesCourse: error rendering EJS', renderErr && renderErr.stack ? renderErr.stack : renderErr);
            return res.status(500).send('<h1>500 - Error interno del servidor</h1>');
        }
    } catch (error) {
        console.error('Error rendering messages for course:', error && error.stack ? error.stack : error);
        // As a last resort, send a simple 500 HTML response to avoid render recursion
        return res.status(500).send('<h1>500 - Error interno del servidor</h1>');
    }
};