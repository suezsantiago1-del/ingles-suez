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