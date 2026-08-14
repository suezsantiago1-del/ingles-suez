import dbPromise from '../config/database.js';

export const renderTeacherPanel = async (req, res) => {
    try {
        const db = await dbPromise;

        // Obtener todas las entregas pendientes o corregidas con datos del usuario y lección
        const entregas = await db.all(`
            SELECT e.id as entrega_id, e.contenido, e.fecha, 
                   u.id as usuario_id, u.nombre as alumno_nombre, u.email as alumno_email,
                   l.titulo as leccion_titulo, l.orden as leccion_orden,
                   d.mensaje as devolucion_mensaje, d.nota
            FROM entregas e
            INNER JOIN usuarios u ON e.usuario_id = u.id
            INNER JOIN lecciones l ON e.leccion_id = l.id
            LEFT JOIN devoluciones d ON e.id = d.entrega_id
            ORDER BY e.fecha DESC
        `);

        return res.render('teacher-panel', { entregas });
    } catch (error) {
        console.error('Error al cargar panel de profesor:', error);
        return res.redirect('/');
    }
};

export const calificarEntrega = async (req, res) => {
    const { entregaId, usuarioId, mensaje, nota } = req.body;
    const notaNum = parseInt(nota);

    if (isNaN(notaNum) || notaNum < 0 || notaNum > 100) {
        return res.status(400).send('La nota debe estar entre 0 y 100.');
    }

    try {
        const db = await dbPromise;

        const existente = await db.get('SELECT id FROM devoluciones WHERE entrega_id = ?', [entregaId]);

        if (existente) {
            await db.run(
                'UPDATE devoluciones SET mensaje = ?, nota = ?, leida = FALSE, fecha = CURRENT_TIMESTAMP WHERE entrega_id = ?',
                [mensaje.trim(), notaNum, entregaId]
            );
        } else {
            await db.run(
                'INSERT INTO devoluciones (entrega_id, usuario_id, mensaje, nota) VALUES (?, ?, ?, ?)',
                [entregaId, usuarioId, mensaje.trim(), notaNum]
            );
        }

        return res.redirect('/teacher-panel');
    } catch (error) {
        console.error('Error al calificar:', error);
        return res.status(500).send('Error al guardar la calificación.');
    }
};

// ==========================================
// CONTROLADORES PARA CLASES PARTICULARES
// ==========================================

export const renderPanelParticularesProfesor = async (req, res) => {
    try {
        const db = await dbPromise;

        const consultas = await db.all(`
            SELECT mp.id, mp.modalidad, mp.objetivo, mp.mensaje_alumno, 
                   mp.respuesta_profesor, mp.fecha_consulta, mp.fecha_respuesta,
                   u.id as usuario_id, u.nombre as usuario_nombre, u.email as usuario_email
            FROM mensajes_particulares mp
            INNER JOIN usuarios u ON mp.usuario_id = u.id
            ORDER BY mp.fecha_consulta DESC
        `);

        return res.render('teacher-particulares-panel', { consultas: consultas || [] });
    } catch (error) {
        console.error('Error al cargar panel de particulares:', error);
        return res.status(500).send('Error al cargar el panel de clases particulares.');
    }
};

export const responderConsultaParticular = async (req, res) => {
    const { consultaId, respuesta } = req.body;

    if (!consultaId || !respuesta || !respuesta.trim()) {
        return res.status(400).json({ success: false, message: 'La respuesta no puede estar vacía.' });
    }

    try {
        const db = await dbPromise;

        await db.run(
            `UPDATE mensajes_particulares 
             SET respuesta_profesor = ?, fecha_respuesta = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [respuesta.trim(), consultaId]
        );

        return res.json({ success: true, message: 'Respuesta guardada correctamente.' });
    } catch (error) {
        console.error('Error al responder consulta particular:', error);
        return res.status(500).json({ success: false, message: 'Error en la base de datos al guardar la respuesta.' });
    }
};