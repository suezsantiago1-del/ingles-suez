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
// CONTROLADORES PARA CLASES PARTICULARES (CHAT RECORRENTE)
// ==========================================

export const renderPanelParticularesProfesor = async (req, res) => {
    try {
        const db = await dbPromise;

        // Obtener consultas principales
        const consultas = await db.all(`
            SELECT mp.id, mp.modalidad, mp.objetivo, mp.mensaje_alumno, 
                   mp.respuesta_profesor, mp.fecha_consulta, mp.fecha_respuesta,
                   u.id as usuario_id, u.nombre as usuario_nombre, u.email as usuario_email
            FROM mensajes_particulares mp
            INNER JOIN usuarios u ON mp.usuario_id = u.id
            ORDER BY mp.fecha_consulta DESC
        `);

        // Cargar historial de chat si existe la tabla
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
        console.error('Error al cargar panel de particulares:', error);
        return res.status(500).send('Error al cargar el panel de clases particulares.');
    }
};

export const responderConsultaParticular = async (req, res) => {
    const { consultaId, respuesta } = req.body;

    if (!consultaId || !respuesta || !respuesta.trim()) {
        return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    try {
        const db = await dbPromise;

        // 1. Obtener datos de la consulta original
        const consulta = await db.get('SELECT usuario_id FROM mensajes_particulares WHERE id = ?', [consultaId]);
        if (!consulta) {
            return res.status(404).json({ success: false, message: 'Consulta no encontrada.' });
        }

        // 2. Actualizar respuesta principal en mensajes_particulares
        await db.run(
            `UPDATE mensajes_particulares 
             SET respuesta_profesor = ?, fecha_respuesta = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [respuesta.trim(), consultaId]
        );

        // 3. Registrar el mensaje en el hilo del chat
        try {
            await db.run(`
                INSERT INTO chat_mensajes_particulares (consulta_id, usuario_id, emisor, mensaje)
                VALUES (?, ?, 'PROFESOR', ?)
            `, [consultaId, consulta.usuario_id, respuesta.trim()]);
        } catch (e) {
            console.log('Tabla de chat secundario en preparación:', e.message);
        }

        return res.json({ success: true, message: 'Mensaje enviado correctamente.' });
    } catch (error) {
        console.error('Error al responder consulta particular:', error);
        return res.status(500).json({ success: false, message: 'Error en la base de datos al guardar la respuesta.' });
    }
};

/**
 * Permite al alumno enviar mensajes adicionales en el mismo chat desde /clases-particulares
 */
export const enviarMensajeAlumnoChat = async (req, res) => {
    const { consultaId, mensaje } = req.body;
    const usuarioId = req.session.user ? req.session.user.id : null;

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

        return res.json({ success: true, message: 'Mensaje enviado al chat.' });
    } catch (error) {
        console.error('Error al guardar mensaje en chat:', error);
        return res.status(500).json({ success: false, message: 'Error interno al enviar mensaje.' });
    }
};