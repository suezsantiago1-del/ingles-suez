import dbPromise from '../config/database.js';

// Mostrar detalle de un curso individual
export const getCourseDetail = async (req, res) => {
    const { id } = req.params;
    const usuarioId = req.session.usuario ? req.session.usuario.id : null;

    try {
        const db = await dbPromise;

        // Obtener la información del curso
        const curso = await db.get("SELECT * FROM cursos WHERE id = ?", [id]);

        if (!curso) {
            return res.status(404).send("Curso no encontrado");
        }

        // Verificar si el usuario ya está inscripto en este curso
        let usuarioInscripto = false;
        if (usuarioId) {
            const compra = await db.get(
                "SELECT * FROM compras WHERE usuario_id = ? AND curso_id = ?",
                [usuarioId, id]
            );
            usuarioInscripto = !!compra;
        }

        res.render('course-detail', {
            curso,
            usuarioInscripto,
            usuario: req.session.usuario || null
        });
    } catch (error) {
        console.error("Error al obtener detalle del curso:", error);
        res.status(500).send("Error interno del servidor");
    }
};

// Procesar la inscripción a un curso (sin duplicados)
export const inscribirCurso = async (req, res) => {
    if (!req.session.usuario) {
        return res.redirect('/login');
    }

    const usuarioId = req.session.usuario.id;
    const { curso_id } = req.body;

    try {
        const db = await dbPromise;

        // 1. Verificar si ya existe la inscripción
        const compraExistente = await db.get(
            "SELECT * FROM compras WHERE usuario_id = ? AND curso_id = ?",
            [usuarioId, curso_id]
        );

        // 2. Insertar solo si no está inscripto previamente
        if (!compraExistente) {
            await db.run(
                "INSERT INTO compras (usuario_id, curso_id) VALUES (?, ?)",
                [usuarioId, curso_id]
            );
        }

        // 3. Redirigir directamente al aula virtual del curso
        res.redirect(`/classroom/${curso_id}`);
    } catch (error) {
        console.error("Error al procesar inscripción:", error);
        res.status(500).send("Error interno del servidor");
    }
};

// Obtener "Mis Cursos" evitando duplicados
export const getMisCursos = async (req, res) => {
    if (!req.session.usuario) {
        return res.redirect('/login');
    }

    const usuarioId = req.session.usuario.id;

    try {
        const db = await dbPromise;

        // Uso de DISTINCT para asegurar que no se muestren cursos repetidos
        const misCursos = await db.all(`
            SELECT DISTINCT c.* 
            FROM cursos c
            JOIN compras com ON c.id = com.curso_id
            WHERE com.usuario_id = ?
        `, [usuarioId]);

        res.render('my-courses', {
            cursos: misCursos,
            usuario: req.session.usuario
        });
    } catch (error) {
        console.error("Error al obtener mis cursos:", error);
        res.status(500).send("Error interno del servidor");
    }
};
// Manejadores de callbacks de pago
export const paymentSuccess = async (req, res) => {
    res.render('payment-status', { 
        status: 'success', 
        message: '¡Pago realizado con éxito! Ya tienes acceso a tu curso.',
        usuario: req.session.usuario || null
    });
};

export const paymentFailure = async (req, res) => {
    res.render('payment-status', { 
        status: 'failure', 
        message: 'Hubo un problema al procesar el pago. Por favor, intenta de nuevo.',
        usuario: req.session.usuario || null
    });
};

export const paymentPending = async (req, res) => {
    res.render('payment-status', { 
        status: 'pending', 
        message: 'Tu pago está pendiente de aprobación.',
        usuario: req.session.usuario || null
    });
};