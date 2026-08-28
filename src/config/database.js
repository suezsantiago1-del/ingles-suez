import pg from 'pg';
import { seedLecciones } from './seeds.js';
import { seedDatosDePrueba } from './devSeeds.js';

class DatabaseAdapter {
    constructor() {
        this.pgPool = new pg.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
        });
    }

    // Convierte marcadores '?' a '$1', '$2', etc. compatibles con PostgreSQL
    parseSql(sql) {
        let paramIndex = 1;
        return sql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    async run(sql, params = []) {
        const pgSql = this.parseSql(sql);
        const res = await this.pgPool.query(pgSql, params);
        
        // Obtiene el ID retornado (si la consulta incluye RETURNING id)
        const returnedRow = res.rows[0];
        const lastID = returnedRow ? (returnedRow.id || returnedRow.lastid || null) : null;

        return { 
            lastID, 
            changes: res.rowCount 
        };
    }

    async all(sql, params = []) {
        const pgSql = this.parseSql(sql);
        const res = await this.pgPool.query(pgSql, params);
        return res.rows;
    }

    async get(sql, params = []) {
        const pgSql = this.parseSql(sql);
        const res = await this.pgPool.query(pgSql, params);
        return res.rows[0] || null;
    }
}

const dbPromise = (async () => {
    const adapter = new DatabaseAdapter();
    
    // Crear tablas en PostgreSQL
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            nombre VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            email_verificado BOOLEAN DEFAULT FALSE,
            verification_token VARCHAR(255),
            verification_token_expires TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cursos (
            id SERIAL PRIMARY KEY,
            titulo VARCHAR(255) NOT NULL,
            descripcion TEXT NOT NULL,
            precio INTEGER NOT NULL,
            imagen_url VARCHAR(255)
        );

        CREATE TABLE IF NOT EXISTS compras (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            curso_id INTEGER NOT NULL,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS lecciones (
            id SERIAL PRIMARY KEY,
            curso_id INTEGER NOT NULL,
            titulo VARCHAR(255) NOT NULL,
            modulo VARCHAR(255) NOT NULL,
            orden INTEGER DEFAULT 1,
            video_url VARCHAR(255),
            contenido_html TEXT
        );

        CREATE TABLE IF NOT EXISTS entregas (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            curso_id INTEGER NOT NULL,
            leccion_id INTEGER NOT NULL,
            contenido TEXT NOT NULL,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS devoluciones (
            id SERIAL PRIMARY KEY,
            entrega_id INTEGER UNIQUE NOT NULL,
            usuario_id INTEGER NOT NULL,
            mensaje TEXT NOT NULL,
            nota INTEGER DEFAULT NULL,
            leida BOOLEAN DEFAULT FALSE,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- NUEVA TABLA PARA EXCLUSIVA DE CLASES PARTICULARES
        CREATE TABLE IF NOT EXISTS mensajes_particulares (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            modalidad VARCHAR(255) NOT NULL,
            objetivo VARCHAR(255) NOT NULL,
            mensaje_alumno TEXT NOT NULL,
            respuesta_profesor TEXT DEFAULT NULL,
            fecha_consulta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            fecha_respuesta TIMESTAMP DEFAULT NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        );
    `);

    // Asegurar columnas y tablas requeridas independientemente del estado previo
    await adapter.pgPool.query(`ALTER TABLE cursos ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255);`);
    await adapter.pgPool.query(`ALTER TABLE devoluciones ADD COLUMN IF NOT EXISTS nota INTEGER DEFAULT NULL;`);
    await adapter.pgPool.query(`ALTER TABLE lecciones ADD COLUMN IF NOT EXISTS video_url TEXT;`);
    await adapter.pgPool.query(`ALTER TABLE lecciones ADD COLUMN IF NOT EXISTS teacher_note TEXT;`);
    await adapter.pgPool.query(`ALTER TABLE cursos ADD COLUMN IF NOT EXISTS instructor_email VARCHAR(255);`);
    await adapter.pgPool.query(`ALTER TABLE entregas ADD COLUMN IF NOT EXISTS teacher_notes TEXT;`);
    
    // Columnas para verificación de email
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT FALSE;`);
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);`);
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP;`);
    
    // Tabla de códigos de descuento
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS codigos_descuento (
            id SERIAL PRIMARY KEY,
            codigo VARCHAR(50) UNIQUE NOT NULL,
            porcentaje INTEGER NOT NULL,
            usos_maximos INTEGER NOT NULL,
            usos_actuales INTEGER DEFAULT 0,
            activo BOOLEAN DEFAULT TRUE,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Crear código de descuento principal si no existe (no depende de SEED_TEST_DATA)
    const codigoExistente = await adapter.pgPool.query(
        'SELECT id FROM codigos_descuento WHERE codigo = $1',
        ['DESCUENTO25']
    );
    
    if (codigoExistente.rows.length === 0) {
        await adapter.pgPool.query(
            'INSERT INTO codigos_descuento (codigo, porcentaje, usos_maximos, usos_actuales, activo) VALUES ($1, $2, $3, $4, $5)',
            ['DESCUENTO25', 25, 50, 0, true]
        );
        console.log('Código de descuento creado: DESCUENTO25 (25% off, 50 usos)');
    }

    // Tabla de desafíos diarios
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS desafios_diarios (
            id SERIAL PRIMARY KEY,
            pregunta TEXT NOT NULL,
            opcion_a TEXT NOT NULL,
            opcion_b TEXT NOT NULL,
            opcion_c TEXT NOT NULL,
            respuesta_correcta VARCHAR(1) NOT NULL,
            explicacion TEXT NOT NULL,
            ejemplo TEXT NOT NULL,
            categoria VARCHAR(50) NOT NULL,
            orden INTEGER NOT NULL
        );
    `);

    await adapter.pgPool.query(`ALTER TABLE desafios_diarios ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) NOT NULL DEFAULT 'quiz'`);
    await adapter.pgPool.query(`ALTER TABLE desafios_diarios ADD COLUMN IF NOT EXISTS texto_audio TEXT`);

    // Tabla de completados del desafío diario (para racha y XP)
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS desafio_completados (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            fecha DATE NOT NULL,
            xp INTEGER NOT NULL DEFAULT 10,
            UNIQUE (usuario_id, fecha)
        );
    `);

    // Tabla de recompensas personalizadas que envía el profesor
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS desafio_recompensas (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            texto TEXT NOT NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);


    // Forzado explícito de creación de mensajes_particulares
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS mensajes_particulares (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            modalidad VARCHAR(255) NOT NULL,
            objetivo VARCHAR(255) NOT NULL,
            mensaje_alumno TEXT NOT NULL,
            respuesta_profesor TEXT DEFAULT NULL,
            fecha_consulta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            fecha_respuesta TIMESTAMP DEFAULT NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        );
    `);

    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS chat_mensajes_particulares (
            id SERIAL PRIMARY KEY,
            consulta_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            emisor VARCHAR(20) NOT NULL,
            mensaje TEXT NOT NULL,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (consulta_id) REFERENCES mensajes_particulares(id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        );
    `);

    // Table for course announcements by instructor
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS curso_anuncios (
            id SERIAL PRIMARY KEY,
            curso_id INTEGER NOT NULL,
            mensaje TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Consultas de alumnos al profesor por lección (idempotente)
    await adapter.pgPool.query(`
        CREATE TABLE IF NOT EXISTS consultas_leccion (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL,
            curso_id INTEGER NOT NULL,
            leccion_id INTEGER NOT NULL,
            mensaje TEXT NOT NULL,
            respuesta_profesor TEXT DEFAULT NULL,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            fecha_respuesta TIMESTAMP DEFAULT NULL
        );
    `);

    // Cursos iniciales (solo si la tabla está vacía)
    const countRes = await adapter.pgPool.query("SELECT COUNT(*) FROM cursos");
    if (parseInt(countRes.rows[0].count) === 0) {
        await adapter.run("INSERT INTO cursos (titulo, descripcion, precio, imagen_url) VALUES (?, ?, ?, ?)", [
            'Inglés Intensivo Desde Cero',
            'Aprende las bases fundamentales del idioma de forma totalmente práctica y natural.',
            5000,
            '/img/logo_2.png'
        ]);
        await adapter.run("INSERT INTO cursos (titulo, descripcion, precio, imagen_url) VALUES (?, ?, ?, ?)", [
            'Conversación y Fluidez Real',
            'Enfocado en hablar sin presiones, mejorar pronunciación y ganar confianza en el día a día.',
            5000,
            '/img/logo_3.png'
        ]);
    }

    await seedLecciones(adapter);

    // Solo corre si SEED_TEST_DATA=true (ver src/config/devSeeds.js)
    await seedDatosDePrueba(adapter);

    return adapter;
})();

export default dbPromise;