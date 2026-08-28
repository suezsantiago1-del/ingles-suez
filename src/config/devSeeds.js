import bcrypt from 'bcrypt';

// ============================================================================
// DATOS DE PRUEBA PARA DESARROLLO
// ============================================================================
// Este archivo NO se ejecuta salvo que la variable de entorno SEED_TEST_DATA
// valga 'true'. Nunca la actives en producción: crea usuarios con contraseña
// conocida y modifica notas.
//
// Antes esto corría en cada arranque del servidor, también en producción.
// ============================================================================

// Cuentas que se resetean para poder repetir el flujo de registro y verificación.
const EMAILS_DESCARTABLES = [
    'suezsanti6@gmail.com',
    'santisuez9@gmail.com',
    'sutrakario32@gmail.com',
    'finopolo21@gmail.com',
    'milerkarion@gmail.com'
];

// Alumnos de prueba que quedan creados, verificados e inscriptos.
const ALUMNOS_DE_PRUEBA = [
    { email: 'lash05mc@gmail.com', nombre: 'Usuario de Prueba' },
    { email: 'beltramemilena5@gmail.com', nombre: 'Milena Beltrame' }
];

const PASSWORD_DE_PRUEBA = 'password123';
const CURSO_DE_PRUEBA = 'Inglés Intensivo Desde Cero';

// Cuenta del profesor: se le limpian las notas aprobadas para poder volver a
// probar el flujo de entrega -> corrección -> certificado.
const EMAIL_PROFESOR = process.env.EMAIL_PROFESOR || 'suezsantiago1@gmail.com';

export async function seedDatosDePrueba(adapter) {
    if (process.env.SEED_TEST_DATA !== 'true') return;

    if (process.env.NODE_ENV === 'production') {
        console.warn(
            '[devSeeds] SEED_TEST_DATA=true con NODE_ENV=production. ' +
            'Se omite por seguridad: estos seeds no deben correr contra la base real.'
        );
        return;
    }

    console.log('[devSeeds] Cargando datos de prueba...');

    // ------------------------------------------------------------------
    // 1. Borrar las cuentas descartables para poder re-registrarlas.
    //    Solo estos emails: no se toca ningún otro usuario.
    // ------------------------------------------------------------------
    const borrados = await adapter.pgPool.query(
        'DELETE FROM usuarios WHERE email = ANY($1)',
        [EMAILS_DESCARTABLES]
    );
    console.log(`[devSeeds] Cuentas descartables borradas: ${borrados.rowCount}`);

    // ------------------------------------------------------------------
    // 2. Desverificar SOLO los alumnos de prueba, para repetir el flujo
    //    de verificación por email sin afectar a los alumnos reales.
    // ------------------------------------------------------------------
    const emailsDePrueba = ALUMNOS_DE_PRUEBA.map(a => a.email);
    await adapter.pgPool.query(
        `UPDATE usuarios
            SET email_verificado = FALSE,
                verification_token = NULL,
                verification_token_expires = NULL
          WHERE email = ANY($1)`,
        [emailsDePrueba]
    );

    // ------------------------------------------------------------------
    // 3. Crear los alumnos de prueba e inscribirlos en el curso.
    // ------------------------------------------------------------------
    const curso = await adapter.pgPool.query(
        'SELECT id FROM cursos WHERE titulo = $1',
        [CURSO_DE_PRUEBA]
    );

    if (curso.rows.length === 0) {
        console.warn(`[devSeeds] No existe el curso "${CURSO_DE_PRUEBA}", se omite la inscripción.`);
        return;
    }
    const cursoId = curso.rows[0].id;

    for (const alumno of ALUMNOS_DE_PRUEBA) {
        const existente = await adapter.pgPool.query(
            'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)',
            [alumno.email]
        );

        let usuarioId;
        if (existente.rows.length === 0) {
            const hash = await bcrypt.hash(PASSWORD_DE_PRUEBA, 10);
            const creado = await adapter.pgPool.query(
                'INSERT INTO usuarios (nombre, email, password, email_verificado) VALUES ($1, $2, $3, TRUE) RETURNING id',
                [alumno.nombre, alumno.email, hash]
            );
            usuarioId = creado.rows[0].id;
            console.log(`[devSeeds] Usuario creado: ${alumno.email} (id ${usuarioId})`);
        } else {
            usuarioId = existente.rows[0].id;
        }

        const compra = await adapter.pgPool.query(
            'SELECT id FROM compras WHERE usuario_id = $1 AND curso_id = $2',
            [usuarioId, cursoId]
        );
        if (compra.rows.length === 0) {
            await adapter.pgPool.query(
                'INSERT INTO compras (usuario_id, curso_id) VALUES ($1, $2)',
                [usuarioId, cursoId]
            );
            console.log(`[devSeeds] ${alumno.email} inscripto en "${CURSO_DE_PRUEBA}"`);
        }
    }

    // ------------------------------------------------------------------
    // 4. Resetear las notas aprobadas del profesor para volver a probar
    //    el flujo de entregas y certificado.
    // ------------------------------------------------------------------
    const profe = await adapter.pgPool.query(
        'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)',
        [EMAIL_PROFESOR]
    );

    if (profe.rows.length > 0) {
        const reset = await adapter.pgPool.query(
            `UPDATE devoluciones SET nota = NULL
              WHERE id IN (
                  SELECT d.id FROM devoluciones d
                    JOIN entregas e ON d.entrega_id = e.id
                   WHERE e.usuario_id = $1 AND d.nota >= 7
              )`,
            [profe.rows[0].id]
        );
        console.log(`[devSeeds] Notas reseteadas para ${EMAIL_PROFESOR}: ${reset.rowCount}`);
    }

    // ------------------------------------------------------------------
    // 5. Crear código de descuento de prueba
    // ------------------------------------------------------------------
    const codigoExistente = await adapter.pgPool.query(
        'SELECT id FROM codigos_descuento WHERE codigo = $1',
        ['DESCUENTO25']
    );
    
    if (codigoExistente.rows.length === 0) {
        await adapter.pgPool.query(
            'INSERT INTO codigos_descuento (codigo, porcentaje, usos_maximos, usos_actuales, activo) VALUES ($1, $2, $3, $4, $5)',
            ['DESCUENTO25', 25, 50, 0, true]
        );
        console.log('[devSeeds] Código de descuento creado: DESCUENTO25 (25% off, 50 usos)');
    }

    console.log('[devSeeds] Listo.');
}
