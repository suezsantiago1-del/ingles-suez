import pg from 'pg';
import { seedLecciones } from './seeds.js';
import { seedDatosDePrueba } from './devSeeds.js';

// El pool se exporta aparte porque el store de sesiones (connect-pg-simple) lo
// necesita al construir el middleware, antes de que `dbPromise` resuelva.
//
// SSL: en Render/Neon la conexión sale a internet y es obligatorio. En el VPS,
// Postgres corre en la red interna de Docker y NO habla TLS: forzarlo ahí hace
// fallar el arranque con "The server does not support SSL connections". Por eso
// lo decide DATABASE_SSL y no la sola presencia de DATABASE_URL.
export const pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

class DatabaseAdapter {
    constructor() {
        this.pgPool = pgPool;
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
    
    // Índices de las claves foráneas. Postgres NO los crea solo (a diferencia
    // de las PK), y todas las consultas del aula y del panel filtran por estas
    // columnas. Son idempotentes, corren en cada arranque sin costo.
    await adapter.pgPool.query(`
        CREATE INDEX IF NOT EXISTS idx_compras_usuario_curso ON compras (usuario_id, curso_id);
        CREATE INDEX IF NOT EXISTS idx_lecciones_curso_orden ON lecciones (curso_id, orden);
        CREATE INDEX IF NOT EXISTS idx_entregas_usuario_leccion ON entregas (usuario_id, leccion_id);
        CREATE INDEX IF NOT EXISTS idx_entregas_curso ON entregas (curso_id);
        CREATE INDEX IF NOT EXISTS idx_devoluciones_usuario ON devoluciones (usuario_id);
    `);

    // Columnas para verificación de email
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT FALSE;`);
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);`);
    await adapter.pgPool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP;`);
    
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