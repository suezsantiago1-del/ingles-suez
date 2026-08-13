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

        return res.redirect(`/classroom/${curso.id}`);
    } catch (error) {
        console.error('Error al procesar la inscripción:', error);
        return res.redirect(`/course/${id}`);
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

        // 1. Validar compra del curso
        const compra = await db.get(
            'SELECT id FROM compras WHERE usuario_id = ? AND curso_id = ?',
            [usuarioId, cursoId]
        );

        if (!compra) {
            return res.redirect(`/course/${cursoId}`);
        }

        const curso = await db.get('SELECT * FROM cursos WHERE id = ?', [cursoId]);
        const lecciones = await db.all('SELECT * FROM lecciones WHERE curso_id = ? ORDER BY orden ASC', [cursoId]);

        if (!lecciones || lecciones.length === 0) {
            return res.send('<h1>Este curso aún no tiene lecciones cargadas.</h1>');
        }

        // 2. Obtener entregas más recientes del alumno con sus devoluciones y notas
        const entregasAlumno = await db.all(`
            SELECT e.leccion_id, d.nota 
            FROM entregas e
            LEFT JOIN devoluciones d ON d.entrega_id = e.id
            WHERE e.usuario_id = ? AND e.curso_id = ?
            ORDER BY e.fecha DESC
        `, [usuarioId, cursoId]);

        // Mapa auxiliar para asociar la última lección entregada -> nota obtenida
        const mapaEntregas = new Map();
        entregasAlumno.forEach(e => {
            if (!mapaEntregas.has(e.leccion_id)) {
                mapaEntregas.set(e.leccion_id, e.nota);
            }
        });

        // 3. Verificar si TODAS las lecciones previas a la Clase 10 están APROBADAS (nota >= 6)
        const leccionesPreviasExamen = lecciones.filter(l => l.orden < 10);
        const todasPreviasAprobadas = leccionesPreviasExamen.length > 0 && leccionesPreviasExamen.every(l => {
            if (!mapaEntregas.has(l.id)) return false; 
            const nota = mapaEntregas.get(l.id);
            return nota !== null && nota !== undefined && parseInt(nota, 10) >= 6;
        });

        // 4. Determinar el estado de desbloqueo cronológico
        let leccionAnteriorAprobadaOEntregada = true;
        const leccionesConEstado = lecciones.map((leccion, index) => {
            const entregada = mapaEntregas.has(leccion.id);
            const nota = mapaEntregas.get(leccion.id);
            let desbloqueada = false;

            if (leccion.orden === 10) {
                desbloqueada = todasPreviasAprobadas;
            } else if (index === 0) {
                desbloqueada = true;
            } else {
                desbloqueada = leccionAnteriorAprobadaOEntregada;
            }

            leccionAnteriorAprobadaOEntregada = entregada;

            return {
                ...leccion,
                completada: entregada,
                nota: nota,
                desbloqueada
            };
        });

        // 5. Determinar la lección activa
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

// Guardar entregas de tareas/revisiones manuales de los alumnos
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

        // Verificar si la lección ya fue APROBADA previamente
        const entregaAprobada = await db.get(`
            SELECT d.nota 
            FROM entregas e
            JOIN devoluciones d ON d.entrega_id = e.id
            WHERE e.usuario_id = ? AND e.leccion_id = ? AND d.nota >= 6
        `, [usuarioId, leccionId]);

        if (entregaAprobada) {
            return res.status(400).json({ 
                success: false, 
                message: 'Esta clase ya se encuentra aprobada y no requiere nuevos envíos.' 
            });
        }

        // Insertar la nueva entrega (sirve tanto para primer envío como para rehacer)
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

// Obtener SOLO entregas PENDIENTES de corrección (EXCLUSIVO PROFESOR)
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

        // Filtra para traer únicamente entregas que no tienen devolución o no tienen nota asignada
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

        return res.render('teacher-panel', { entregas });
    } catch (error) {
        console.error('Error al obtener las entregas:', error);
        return res.redirect('/');
    }
};

// Guardar devolución/corrección enviada por el profesor (incluyendo nota)
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

// Bandeja de Entrada de Mensajes/Devoluciones para Alumnos
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

// Generar y descargar el Certificado en PDF al aprobar la Clase 10
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
        `, [usuarioId, leccion10.id]);

        if (!devolucionExamen) {
            return res.status(403).send('<h1>Aún no has aprobado el examen final (Clase 10) para descargar este certificado.</h1>');
        }

        const usuario = await db.get('SELECT nombre FROM usuarios WHERE id = ?', [usuarioId]);
        const curso = await db.get('SELECT titulo FROM cursos WHERE id = ?', [cursoId]);

        const pdfPath = path.join(__dirname, '../../public/certificados/plantilla.pdf');
        
        if (!fs.existsSync(pdfPath)) {
            return res.status(500).send('Error: Plantilla de certificado no encontrada en el servidor.');
        }

        const existingPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

        firstPage.drawText(usuario.nombre.toUpperCase(), {
            x: 200,
            y: 320,
            size: 28,
            font: fontBold,
            color: rgb(0.04, 0.13, 0.22)
        });

        firstPage.drawText(curso.titulo, {
            x: 200,
            y: 250,
            size: 20,
            font: fontRegular,
            color: rgb(0.1, 0.1, 0.1)
        });

        const fechaAprobacion = new Date(devolucionExamen.fecha).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });

        firstPage.drawText(`Emitido el ${fechaAprobacion}`, {
            x: 200,
            y: 180,
            size: 12,
            font: fontRegular,
            color: rgb(0.4, 0.4, 0.4)
        });

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Certificado_${usuario.nombre.replace(/\s+/g, '_')}.pdf"`);
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error generando certificado:', error);
        return res.status(500).send('Error interno al generar el certificado.');
    }
};