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

    // Sincronizar siempre los 20 desafíos diarios (contenido fijo)
    await adapter.pgPool.query('DELETE FROM desafios_diarios');
    {
        const desafios = [
            {
                pregunta: "¿Cuál suena más natural para decir “Hace mucho que no te veo”?",
                opcion_a: "I don't see you since long.",
                opcion_b: "I haven't seen you in a long time.",
                opcion_c: "I didn't see you since long.",
                respuesta_correcta: "B",
                explicacion: "'I haven't seen you in a long time' es la forma natural de expresarlo.",
                ejemplo: "I haven't seen Sarah in a long time.",
                categoria: "Natural English",
                orden: 1
            },
            {
                pregunta: "¿Cuál es correcta?",
                opcion_a: "She have a car.",
                opcion_b: "She has a car.",
                opcion_c: "She haves a car.",
                respuesta_correcta: "B",
                explicacion: "En tercera persona singular (She/He/It) el verbo to have se conjuga como has.",
                ejemplo: "She has a new phone.",
                categoria: "Common Mistake",
                orden: 2
            },
            {
                pregunta: "Alguien te dice: “How are you?” ¿Cuál es una respuesta natural?",
                opcion_a: "I have 17 years.",
                opcion_b: "I'm good, thanks. How about you?",
                opcion_c: "I am fine, and you are?",
                respuesta_correcta: "B",
                explicacion: "'I'm good, thanks. How about you?' es una respuesta natural y amigable.",
                ejemplo: "I'm good, thanks. How about you?",
                categoria: "Everyday English",
                orden: 3
            },
            {
                pregunta: "¿Qué significa “awkward”?",
                opcion_a: "Incómodo / extraño",
                opcion_b: "Enojado",
                opcion_c: "Cansado",
                respuesta_correcta: "A",
                explicacion: "awkward significa incómodo o extraño.",
                ejemplo: "That was an awkward conversation.",
                categoria: "Vocabulary",
                orden: 4
            },
            {
                pregunta: "¿Cuál usarías para pedirle a alguien que espere?",
                opcion_a: "Wait me.",
                opcion_b: "Wait for me.",
                opcion_c: "Wait to me.",
                respuesta_correcta: "B",
                explicacion: "El verbo wait se construye con for + la persona u objeto esperado.",
                ejemplo: "Wait for me, please.",
                categoria: "Natural English",
                orden: 5
            },
            {
                pregunta: "Un amigo te pregunta: “Do you want to come with us?” ¿Cuál respuesta significa “Dale, de una”?",
                opcion_a: "Sure, why not?",
                opcion_b: "Yes, I want.",
                opcion_c: "I do.",
                respuesta_correcta: "A",
                explicacion: "'Sure, why not?' es la respuesta casual que equivale a “Dale, de una”.",
                ejemplo: "Sure, why not? Count me in.",
                categoria: "Everyday English",
                orden: 6
            },
            {
                pregunta: "¿Cuál es correcta?",
                opcion_a: "I'm agree.",
                opcion_b: "I agree.",
                opcion_c: "I am agreeing.",
                respuesta_correcta: "B",
                explicacion: "agree es un verbo, no adjetivo: se dice I agree, nunca I'm agree.",
                ejemplo: "I agree with you.",
                categoria: "Common Mistake",
                orden: 7
            },
            {
                pregunta: "¿Qué significa “actually”?",
                opcion_a: "Actualmente",
                opcion_b: "En realidad",
                opcion_c: "Eventualmente",
                respuesta_correcta: "B",
                explicacion: "actually significa “en realidad”, no “actualmente”.",
                ejemplo: "Actually, I don't like coffee.",
                categoria: "Vocabulary",
                orden: 8
            },
            {
                pregunta: "Llegás tarde a una reunión. ¿Qué dirías naturalmente?",
                opcion_a: "Sorry I'm late.",
                opcion_b: "Sorry for be late.",
                opcion_c: "Excuse me for my late.",
                respuesta_correcta: "A",
                explicacion: "'Sorry I'm late' es la forma simple y natural de disculparse por llegar tarde.",
                ejemplo: "Sorry I'm late, the traffic was terrible.",
                categoria: "Everyday English",
                orden: 9
            },
            {
                pregunta: "¿Cómo dirías “No tengo idea”?",
                opcion_a: "I don't have idea.",
                opcion_b: "I have no idea.",
                opcion_c: "I haven't idea.",
                respuesta_correcta: "B",
                explicacion: "La expresión fija es I have no idea.",
                ejemplo: "I have no idea what you're talking about.",
                categoria: "Natural English",
                orden: 10
            },
            {
                pregunta: "¿Qué significa “borrow”?",
                opcion_a: "Prestarle algo a alguien",
                opcion_b: "Pedir algo prestado",
                opcion_c: "Comprar algo barato",
                respuesta_correcta: "B",
                explicacion: "borrow significa pedir prestado (el que recibe).",
                ejemplo: "Can I borrow your pen?",
                categoria: "Vocabulary",
                orden: 11
            },
            {
                pregunta: "¿Cuál es correcta?",
                opcion_a: "I'm 17 years old.",
                opcion_b: "I have 17 years old.",
                opcion_c: "I am 17 years.",
                respuesta_correcta: "A",
                explicacion: "La edad se expresa con el verbo to be + edad + years old.",
                ejemplo: "I'm 17 years old.",
                categoria: "Common Mistake",
                orden: 12
            },
            {
                pregunta: "¿Cómo responderías naturalmente a “Thank you”?",
                opcion_a: "You're welcome.",
                opcion_b: "Welcome you.",
                opcion_c: "You welcome.",
                respuesta_correcta: "A",
                explicacion: "La respuesta estándar y natural a Thank you es You're welcome.",
                ejemplo: "Thanks so much! — You're welcome.",
                categoria: "Everyday English",
                orden: 13
            },
            {
                pregunta: "¿Cuál significa “Depende”?",
                opcion_a: "It depends.",
                opcion_b: "It depend.",
                opcion_c: "Depends it.",
                respuesta_correcta: "A",
                explicacion: "Depende se traduce como It depends.",
                ejemplo: "It depends on the weather.",
                categoria: "Natural English",
                orden: 14
            },
            {
                pregunta: "¿Qué significa “quiet”?",
                opcion_a: "Rápido",
                opcion_b: "Tranquilo / silencioso",
                opcion_c: "Extraño",
                respuesta_correcta: "B",
                explicacion: "quiet significa tranquilo o silencioso.",
                ejemplo: "Please be quiet in the library.",
                categoria: "Vocabulary",
                orden: 15
            },
            {
                pregunta: "Querés pedirle a alguien que repita lo que dijo.",
                opcion_a: "Repeat.",
                opcion_b: "Can you say that again?",
                opcion_c: "Say again that.",
                respuesta_correcta: "B",
                explicacion: "'Can you say that again?' es la forma natural de pedir una repetición.",
                ejemplo: "Sorry, can you say that again?",
                categoria: "Everyday English",
                orden: 16
            },
            {
                pregunta: "¿Cuál es correcta?",
                opcion_a: "I have a lot of informations.",
                opcion_b: "I have a lot of information.",
                opcion_c: "I have many information.",
                respuesta_correcta: "B",
                explicacion: "information es incontable: no lleva plural, se usa a lot of.",
                ejemplo: "I have a lot of information to share.",
                categoria: "Common Mistake",
                orden: 17
            },
            {
                pregunta: "¿Cómo dirías “Me olvidé”?",
                opcion_a: "I forgot.",
                opcion_b: "I forget it.",
                opcion_c: "I was forgot.",
                respuesta_correcta: "A",
                explicacion: "El pasado de forget es forgot: I forgot.",
                ejemplo: "I forgot my keys at home.",
                categoria: "Natural English",
                orden: 18
            },
            {
                pregunta: "¿Qué significa “actually”?",
                opcion_a: "En realidad",
                opcion_b: "Exactamente ahora",
                opcion_c: "Actualmente",
                respuesta_correcta: "A",
                explicacion: "actually significa “en realidad”.",
                ejemplo: "Actually, I can't come tomorrow.",
                categoria: "Vocabulary",
                orden: 19
            },
            {
                pregunta: "Alguien dice: “I'm exhausted.” ¿Qué significa?",
                opcion_a: "Estoy emocionado.",
                opcion_b: "Estoy agotado.",
                opcion_c: "Estoy aburrido.",
                respuesta_correcta: "B",
                explicacion: "exhausted significa estar agotado, sin energía.",
                ejemplo: "I'm exhausted after the workout.",
                categoria: "Everyday English",
                orden: 20
            }
        ];


        for (const desafio of desafios) {
            await adapter.pgPool.query(
                'INSERT INTO desafios_diarios (pregunta, opcion_a, opcion_b, opcion_c, respuesta_correcta, explicacion, ejemplo, categoria, orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [desafio.pregunta, desafio.opcion_a, desafio.opcion_b, desafio.opcion_c, desafio.respuesta_correcta, desafio.explicacion, desafio.ejemplo, desafio.categoria, desafio.orden]
            );
        }
        console.log('Desafíos diarios sincronizados en la base de datos');
    }

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