import dbPromise from '../config/database.js';
import { MercadoPagoConfig, Preference } from 'mercadopago';

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

        // =========================================================================
        // MODO PRUEBA / GRATUITO TEMPORAL (Inscripción directa sin duplicados)
        // =========================================================================
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

        /* 
        // =========================================================================
        // MODO PRODUCCIÓN (MERCADO PAGO) - Descomentar cuando quieras volver a cobrar:
        // =========================================================================

        if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN.trim().length < 10) {
            return res.send(`
                <div style="font-family: sans-serif; padding: 2rem; max-width: 600px; margin: 4rem auto; background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px;">
                    <h2 style="color: #c53030;">Error: Falta el Token de Mercado Pago</h2>
                    <p>El archivo <code>.env</code> no contiene un <code>MP_ACCESS_TOKEN</code> válido.</p>
                    <a href="/course/${id}">Volver al curso</a>
                </div>
            `);
        }

        const preference = new Preference(client);

        const response = await preference.create({
            body: {
                items: [
                    {
                        id: String(curso.id),
                        title: String(curso.titulo),
                        unit_price: Number(curso.precio),
                        quantity: 1,
                        currency_id: 'ARS'
                    }
                ],
                payer: {
                    name: String(req.session.user.nombre),
                    email: String(req.session.user.email)
                },
                back_urls: {
                    success: `http://localhost:3000/payment/success?cursoId=${curso.id}`,
                    failure: `http://localhost:3000/payment/failure?cursoId=${curso.id}`,
                    pending: `http://localhost:3000/payment/pending?cursoId=${curso.id}`
                },
                external_reference: `USER_${usuarioId}_COURSE_${curso.id}`
            }
        });

        const redirectUrl = response.init_point || response.sandbox_init_point;

        if (redirectUrl) {
            return res.redirect(redirectUrl);
        } else {
            return res.send(`
                <div style="font-family: sans-serif; padding: 2rem; max-width: 600px; margin: 4rem auto; background: #fffaf0; border: 1px solid #fbd38d; border-radius: 8px;">
                    <h2 style="color: #c05621;">Respuesta inesperada de Mercado Pago</h2>
                    <pre style="background: #edf2f7; padding: 1rem; border-radius: 4px;">${JSON.stringify(response, null, 2)}</pre>
                    <a href="/course/${id}">Volver al curso</a>
                </div>
            `);
        }
        */

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

        // Verificar inscripción
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

        let leccionActiva = lecciones[0];
        if (leccionId) {
            const encontrada = lecciones.find(l => l.id == leccionId);
            if (encontrada) leccionActiva = encontrada;
        }

        return res.render('classroom', { curso, lecciones, leccionActiva });
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

// Obtener el listado de entregas realizadas por los alumnos (EXCLUSIVO PROFESOR)
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
                e.contenido,
                e.fecha,
                u.nombre AS usuario_nombre,
                u.email AS usuario_email,
                c.titulo AS curso_titulo,
                l.titulo AS leccion_titulo
            FROM entregas e
            JOIN usuarios u ON e.usuario_id = u.id
            JOIN cursos c ON e.curso_id = c.id
            JOIN lecciones l ON e.leccion_id = l.id
            ORDER BY e.fecha DESC
        `);

        return res.render('teacher-panel', { entregas });
    } catch (error) {
        console.error('Error al obtener las entregas:', error);
        return res.redirect('/');
    }
};