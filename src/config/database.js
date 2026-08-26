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

    // Insertar 30 desafíos si la tabla está vacía
    const desafiosCount = await adapter.pgPool.query('SELECT COUNT(*) as count FROM desafios_diarios');
    if (desafiosCount.rows[0].count === 0) {
        const desafios = [
            {
                pregunta: "¿Cuál es la forma correcta de decir 'I am very happy' en un contexto informal?",
                opcion_a: "I'm very happy",
                opcion_b: "I am very happy",
                opcion_c: "I'm being very happy",
                respuesta_correcta: "A",
                explicacion: "En inglés informal, usamos contracciones como 'I'm' en lugar de 'I am'.",
                ejemplo: "I'm very happy to see you!",
                categoria: "Natural English",
                orden: 1
            },
            {
                pregunta: "¿Cómo se traduce correctamente 'Hace calor'?",
                opcion_a: "It does hot",
                opcion_b: "It's hot",
                opcion_c: "It makes hot",
                respuesta_correcta: "B",
                explicacion: "Para describir el clima usamos 'It is' o su contracción 'It's'.",
                ejemplo: "It's hot today, let's go to the beach.",
                categoria: "Common Mistake",
                orden: 2
            },
            {
                pregunta: "¿Cuál opción es más natural para pedir algo en un restaurante?",
                opcion_a: "I want a coffee",
                opcion_b: "I would like a coffee",
                opcion_c: "I like a coffee",
                respuesta_correcta: "B",
                explicacion: "'I would like' es más educado y natural en situaciones formales.",
                ejemplo: "I would like a coffee, please.",
                categoria: "Speaking",
                orden: 3
            },
            {
                pregunta: "¿Cómo se dice 'Tengo hambre' en inglés?",
                opcion_a: "I have hunger",
                opcion_b: "I am hungry",
                opcion_c: "I'm hungry",
                respuesta_correcta: "C",
                explicacion: "La forma más natural es usar la contracción 'I'm' con el adjetivo 'hungry'.",
                ejemplo: "I'm hungry, let's eat something.",
                categoria: "Vocabulary",
                orden: 4
            },
            {
                pregunta: "¿Cuál es la respuesta correcta a 'How are you?'?",
                opcion_a: "I am fine, thank you",
                opcion_b: "I'm fine, thanks",
                opcion_c: "I'm good, thanks",
                respuesta_correcta: "C",
                explicacion: "'I'm good' es la respuesta más común y natural en inglés americano.",
                ejemplo: "I'm good, thanks! How about you?",
                categoria: "Natural English",
                orden: 5
            },
            {
                pregunta: "¿Cómo se traduce 'Voy a ir al cine'?",
                opcion_a: "I will go to the cinema",
                opcion_b: "I'm going to go to the cinema",
                opcion_c: "I go to the cinema",
                respuesta_correcta: "B",
                explicacion: "Para planes futuros usamos 'going to' + verbo base.",
                ejemplo: "I'm going to go to the cinema tonight.",
                categoria: "Common Mistake",
                orden: 6
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ella trabaja aquí'?",
                opcion_a: "She works here",
                opcion_b: "She work here",
                opcion_c: "She working here",
                respuesta_correcta: "A",
                explicacion: "Con tercera persona singular (she/he/it) agregamos 's' al verbo.",
                ejemplo: "She works here every day.",
                categoria: "Common Mistake",
                orden: 7
            },
            {
                pregunta: "¿Cómo se dice 'No lo sé' en inglés?",
                opcion_a: "I don't know it",
                opcion_b: "I don't know",
                opcion_c: "I not know",
                respuesta_correcta: "B",
                explicacion: "La forma correcta es 'I don't know' sin objeto directo.",
                ejemplo: "I don't know the answer.",
                categoria: "Vocabulary",
                orden: 8
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'What time is it?'?",
                opcion_a: "It is five o'clock",
                opcion_b: "It's five o'clock",
                opcion_c: "Is five o'clock",
                respuesta_correcta: "B",
                explicacion: "Usamos la contracción 'It's' para expresar la hora de forma natural.",
                ejemplo: "It's five o'clock already.",
                categoria: "Natural English",
                orden: 9
            },
            {
                pregunta: "¿Cómo se traduce 'Me gusta el café'?",
                opcion_a: "I like the coffee",
                opcion_b: "I like coffee",
                opcion_c: "I like of coffee",
                respuesta_correcta: "B",
                explicacion: "En inglés no usamos 'the' antes de sustantivos generales como 'coffee'.",
                ejemplo: "I like coffee in the morning.",
                categoria: "Common Mistake",
                orden: 10
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir '¿Puedes ayudarme?'?",
                opcion_a: "Can you help me?",
                opcion_b: "Could you help me?",
                opcion_c: "Do you can help me?",
                respuesta_correcta: "A",
                explicacion: "'Can you' es la forma más directa y común para pedir ayuda.",
                ejemplo: "Can you help me with this exercise?",
                categoria: "Speaking",
                orden: 11
            },
            {
                pregunta: "¿Cómo se dice 'Estoy aprendiendo inglés'?",
                opcion_a: "I learning English",
                opcion_b: "I'm learning English",
                opcion_c: "I learn English",
                respuesta_correcta: "B",
                explicacion: "Usamos 'I'm' + verbo en -ing para acciones en progreso.",
                ejemplo: "I'm learning English online.",
                categoria: "Vocabulary",
                orden: 12
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir '¿Dónde está el baño?'?",
                opcion_a: "Where is the bathroom?",
                opcion_b: "Where the bathroom is?",
                opcion_c: "Where bathroom is?",
                respuesta_correcta: "A",
                explicacion: "Las preguntas con 'where' usan inversión verbo-sujeto.",
                ejemplo: "Where is the bathroom, please?",
                categoria: "Speaking",
                orden: 13
            },
            {
                pregunta: "¿Cómo se traduce 'Él no quiere ir'?",
                opcion_a: "He not want to go",
                opcion_b: "He doesn't want to go",
                opcion_c: "He don't want to go",
                respuesta_correcta: "B",
                explicacion: "Con 'he' usamos 'doesn't' + verbo base (sin 'to').",
                ejemplo: "He doesn't want to go tonight.",
                categoria: "Common Mistake",
                orden: 14
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'Nice to meet you'?",
                opcion_a: "Nice to meet you too",
                opcion_b: "Nice meeting you too",
                opcion_c: "Nice to see you too",
                respuesta_correcta: "A",
                explicacion: "'Nice to meet you too' es la respuesta estándar a presentaciones.",
                ejemplo: "Nice to meet you too! I'm John.",
                categoria: "Natural English",
                orden: 15
            },
            {
                pregunta: "¿Cómo se dice '¿Cuánto cuesta?'?",
                opcion_a: "How much cost?",
                opcion_b: "How much does it cost?",
                opcion_c: "How much is it?",
                respuesta_correcta: "C",
                explicacion: "'How much is it?' es la forma más común para preguntar precio.",
                ejemplo: "How much is it? It's $50.",
                categoria: "Speaking",
                orden: 16
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Tengo que trabajar'?",
                opcion_a: "I have to work",
                opcion_b: "I must to work",
                opcion_c: "I have work",
                respuesta_correcta: "A",
                explicacion: "'I have to' expresa obligación de forma natural.",
                ejemplo: "I have to work late today.",
                categoria: "Vocabulary",
                orden: 17
            },
            {
                pregunta: "¿Cómo se traduce 'Estoy buscando mi llave'?",
                opcion_a: "I'm looking for my key",
                opcion_b: "I looking for my key",
                opcion_c: "I look for my key",
                respuesta_correcta: "A",
                explicacion: "Usamos 'I'm' + verbo en -ing para acciones en progreso.",
                ejemplo: "I'm looking for my car keys.",
                categoria: "Natural English",
                orden: 18
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ellos hablan español'?",
                opcion_a: "They speaks Spanish",
                opcion_b: "They speak Spanish",
                opcion_c: "They speaking Spanish",
                respuesta_correcta: "B",
                explicacion: "Con 'they' usamos el verbo base sin agregar 's'.",
                ejemplo: "They speak Spanish fluently.",
                categoria: "Common Mistake",
                orden: 19
            },
            {
                pregunta: "¿Cómo se dice '¿Te gusta el chocolate?'?",
                opcion_a: "Do you like chocolate?",
                opcion_b: "You like chocolate?",
                opcion_c: "Are you like chocolate?",
                respuesta_correcta: "A",
                explicacion: "Usamos 'Do you like' para preguntar preferencias.",
                ejemplo: "Do you like chocolate? I love it!",
                categoria: "Speaking",
                orden: 20
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'I'm sorry'?",
                opcion_a: "It's okay",
                opcion_b: "No problem",
                opcion_c: "Don't worry",
                respuesta_correcta: "B",
                explicacion: "'No problem' es la respuesta más común y natural.",
                ejemplo: "I'm sorry. No problem, it happens.",
                categoria: "Natural English",
                orden: 21
            },
            {
                pregunta: "¿Cómo se traduce '¿Puedo ir al baño?'?",
                opcion_a: "Can I go to the bathroom?",
                opcion_b: "May I go to the bathroom?",
                opcion_c: "Could I go to the bathroom?",
                respuesta_correcta: "A",
                explicacion: "'Can I' es más común y directo para pedir permiso.",
                ejemplo: "Can I go to the bathroom, please?",
                categoria: "Speaking",
                orden: 22
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Nosotros fuimos al cine'?",
                opcion_a: "We went to the cinema",
                opcion_b: "We go to the cinema",
                opcion_c: "We have gone to the cinema",
                respuesta_correcta: "A",
                explicacion: "Para pasado usamos el verbo irregular 'went' de 'go'.",
                ejemplo: "We went to the cinema last night.",
                categoria: "Common Mistake",
                orden: 23
            },
            {
                pregunta: "¿Cómo se dice '¿Cuándo naciste?'?",
                opcion_a: "When you born?",
                opcion_b: "When did you born?",
                opcion_c: "When were you born?",
                respuesta_correcta: "C",
                explicacion: "Para preguntas en pasado usamos 'were you born' con auxiliar.",
                ejemplo: "When were you born? In 1990.",
                categoria: "Speaking",
                orden: 24
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ella está cansada'?",
                opcion_a: "She is tired",
                opcion_b: "She tired",
                opcion_c: "She's tired",
                respuesta_correcta: "C",
                explicacion: "La contracción 'She's' es más natural que 'She is'.",
                ejemplo: "She's tired after work.",
                categoria: "Natural English",
                orden: 25
            },
            {
                pregunta: "¿Cómo se traduce '¿Puedo tener un vaso de agua?'?",
                opcion_a: "Can I have a glass of water?",
                opcion_b: "Can I have glass of water?",
                opcion_c: "May I have a glass of water?",
                respuesta_correcta: "A",
                explicacion: "'Can I have' es la forma más común para pedir algo.",
                ejemplo: "Can I have a glass of water, please?",
                categoria: "Speaking",
                orden: 26
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'No lo tengo'?",
                opcion_a: "I don't have it",
                opcion_b: "I not have it",
                opcion_c: "I haven't it",
                respuesta_correcta: "A",
                explicacion: "Usamos 'don't have' para negar posesión en presente.",
                ejemplo: "I don't have my phone.",
                categoria: "Common Mistake",
                orden: 27
            },
            {
                pregunta: "¿Cómo se dice '¿Tienes tiempo?'?",
                opcion_a: "Do you have time?",
                opcion_b: "Have you time?",
                opcion_c: "Are you have time?",
                respuesta_correcta: "A",
                explicacion: "Para preguntar posesión usamos 'Do you have' con auxiliar.",
                ejemplo: "Do you have time to talk?",
                categoria: "Speaking",
                orden: 28
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'Good luck'?",
                opcion_a: "Thanks",
                opcion_b: "Good luck too",
                opcion_c: "Thank you",
                respuesta_correcta: "C",
                explicacion: "'Thank you' es la respuesta más común a 'Good luck'.",
                ejemplo: "Good luck! Thank you.",
                categoria: "Natural English",
                orden: 29
            },
            {
                pregunta: "¿Cómo se traduce 'Estoy emocionado'?",
                opcion_a: "I'm excited",
                opcion_b: "I excited",
                opcion_c: "I am exciting",
                respuesta_correcta: "A",
                explicacion: "Usamos 'I'm' + adjetivo para describir emociones.",
                ejemplo: "I'm excited about the trip!",
                categoria: "Vocabulary",
                orden: 30
            }
        ];

        for (const desafio of desafios) {
            await adapter.pgPool.query(
                'INSERT INTO desafios_diarios (pregunta, opcion_a, opcion_b, opcion_c, respuesta_correcta, explicacion, ejemplo, categoria, orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [desafio.pregunta, desafio.opcion_a, desafio.opcion_b, desafio.opcion_c, desafio.respuesta_correcta, desafio.explicacion, desafio.ejemplo, desafio.categoria, desafio.orden]
            );
        }
        console.log('30 desafíos diarios creados en la base de datos');
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

    // Insertar 30 desafíos si la tabla está vacía
    const desafiosCount = await adapter.pgPool.query('SELECT COUNT(*) as count FROM desafios_diarios');
    if (desafiosCount.rows[0].count === 0) {
        const desafios = [
            {
                pregunta: "¿Cuál es la forma correcta de decir 'I am very happy' en un contexto informal?",
                opcion_a: "I'm very happy",
                opcion_b: "I am very happy",
                opcion_c: "I'm being very happy",
                respuesta_correcta: "A",
                explicacion: "En inglés informal, usamos contracciones como 'I'm' en lugar de 'I am'.",
                ejemplo: "I'm very happy to see you!",
                categoria: "Natural English",
                orden: 1
            },
            {
                pregunta: "¿Cómo se traduce correctamente 'Hace calor'?",
                opcion_a: "It does hot",
                opcion_b: "It's hot",
                opcion_c: "It makes hot",
                respuesta_correcta: "B",
                explicacion: "Para describir el clima usamos 'It is' o su contracción 'It's'.",
                ejemplo: "It's hot today, let's go to the beach.",
                categoria: "Common Mistake",
                orden: 2
            },
            {
                pregunta: "¿Cuál opción es más natural para pedir algo en un restaurante?",
                opcion_a: "I want a coffee",
                opcion_b: "I would like a coffee",
                opcion_c: "I like a coffee",
                respuesta_correcta: "B",
                explicacion: "'I would like' es más educado y natural en situaciones formales.",
                ejemplo: "I would like a coffee, please.",
                categoria: "Speaking",
                orden: 3
            },
            {
                pregunta: "¿Cómo se dice 'Tengo hambre' en inglés?",
                opcion_a: "I have hunger",
                opcion_b: "I am hungry",
                opcion_c: "I'm hungry",
                respuesta_correcta: "C",
                explicacion: "La forma más natural es usar la contracción 'I'm' con el adjetivo 'hungry'.",
                ejemplo: "I'm hungry, let's eat something.",
                categoria: "Vocabulary",
                orden: 4
            },
            {
                pregunta: "¿Cuál es la respuesta correcta a 'How are you?'?",
                opcion_a: "I am fine, thank you",
                opcion_b: "I'm fine, thanks",
                opcion_c: "I'm good, thanks",
                respuesta_correcta: "C",
                explicacion: "'I'm good' es la respuesta más común y natural en inglés americano.",
                ejemplo: "I'm good, thanks! How about you?",
                categoria: "Natural English",
                orden: 5
            },
            {
                pregunta: "¿Cómo se traduce 'Voy a ir al cine'?",
                opcion_a: "I will go to the cinema",
                opcion_b: "I'm going to go to the cinema",
                opcion_c: "I go to the cinema",
                respuesta_correcta: "B",
                explicacion: "Para planes futuros usamos 'going to' + verbo base.",
                ejemplo: "I'm going to go to the cinema tonight.",
                categoria: "Common Mistake",
                orden: 6
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ella trabaja aquí'?",
                opcion_a: "She works here",
                opcion_b: "She work here",
                opcion_c: "She working here",
                respuesta_correcta: "A",
                explicacion: "Con tercera persona singular (she/he/it) agregamos 's' al verbo.",
                ejemplo: "She works here every day.",
                categoria: "Common Mistake",
                orden: 7
            },
            {
                pregunta: "¿Cómo se dice 'No lo sé' en inglés?",
                opcion_a: "I don't know it",
                opcion_b: "I don't know",
                opcion_c: "I not know",
                respuesta_correcta: "B",
                explicacion: "La forma correcta es 'I don't know' sin objeto directo.",
                ejemplo: "I don't know the answer.",
                categoria: "Vocabulary",
                orden: 8
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'What time is it?'?",
                opcion_a: "It is five o'clock",
                opcion_b: "It's five o'clock",
                opcion_c: "Is five o'clock",
                respuesta_correcta: "B",
                explicacion: "Usamos la contracción 'It's' para expresar la hora de forma natural.",
                ejemplo: "It's five o'clock already.",
                categoria: "Natural English",
                orden: 9
            },
            {
                pregunta: "¿Cómo se traduce 'Me gusta el café'?",
                opcion_a: "I like the coffee",
                opcion_b: "I like coffee",
                opcion_c: "I like of coffee",
                respuesta_correcta: "B",
                explicacion: "En inglés no usamos 'the' antes de sustantivos generales como 'coffee'.",
                ejemplo: "I like coffee in the morning.",
                categoria: "Common Mistake",
                orden: 10
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir '¿Puedes ayudarme?'?",
                opcion_a: "Can you help me?",
                opcion_b: "Could you help me?",
                opcion_c: "Do you can help me?",
                respuesta_correcta: "A",
                explicacion: "'Can you' es la forma más directa y común para pedir ayuda.",
                ejemplo: "Can you help me with this exercise?",
                categoria: "Speaking",
                orden: 11
            },
            {
                pregunta: "¿Cómo se dice 'Estoy aprendiendo inglés'?",
                opcion_a: "I learning English",
                opcion_b: "I'm learning English",
                opcion_c: "I learn English",
                respuesta_correcta: "B",
                explicacion: "Usamos 'I'm' + verbo en -ing para acciones en progreso.",
                ejemplo: "I'm learning English online.",
                categoria: "Vocabulary",
                orden: 12
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir '¿Dónde está el baño?'?",
                opcion_a: "Where is the bathroom?",
                opcion_b: "Where the bathroom is?",
                opcion_c: "Where bathroom is?",
                respuesta_correcta: "A",
                explicacion: "Las preguntas con 'where' usan inversión verbo-sujeto.",
                ejemplo: "Where is the bathroom, please?",
                categoria: "Speaking",
                orden: 13
            },
            {
                pregunta: "¿Cómo se traduce 'Él no quiere ir'?",
                opcion_a: "He not want to go",
                opcion_b: "He doesn't want to go",
                opcion_c: "He don't want to go",
                respuesta_correcta: "B",
                explicacion: "Con 'he' usamos 'doesn't' + verbo base (sin 'to').",
                ejemplo: "He doesn't want to go tonight.",
                categoria: "Common Mistake",
                orden: 14
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'Nice to meet you'?",
                opcion_a: "Nice to meet you too",
                opcion_b: "Nice meeting you too",
                opcion_c: "Nice to see you too",
                respuesta_correcta: "A",
                explicacion: "'Nice to meet you too' es la respuesta estándar a presentaciones.",
                ejemplo: "Nice to meet you too! I'm John.",
                categoria: "Natural English",
                orden: 15
            },
            {
                pregunta: "¿Cómo se dice '¿Cuánto cuesta?'?",
                opcion_a: "How much cost?",
                opcion_b: "How much does it cost?",
                opcion_c: "How much is it?",
                respuesta_correcta: "C",
                explicion: "'How much is it?' es la forma más común para preguntar precio.",
                ejemplo: "How much is it? It's $50.",
                categoria: "Speaking",
                orden: 16
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Tengo que trabajar'?",
                opcion_a: "I have to work",
                opcion_b: "I must to work",
                opcion_c: "I have work",
                respuesta_correcta: "A",
                explicacion: "'I have to' expresa obligación de forma natural.",
                ejemplo: "I have to work late today.",
                categoria: "Vocabulary",
                orden: 17
            },
            {
                pregunta: "¿Cómo se traduce 'Estoy buscando mi llave'?",
                opcion_a: "I'm looking for my key",
                opcion_b: "I looking for my key",
                opcion_c: "I look for my key",
                respuesta_correcta: "A",
                explicacion: "Usamos 'I'm' + verbo en -ing para acciones en progreso.",
                ejemplo: "I'm looking for my car keys.",
                categoria: "Natural English",
                orden: 18
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ellos hablan español'?",
                opcion_a: "They speaks Spanish",
                opcion_b: "They speak Spanish",
                opcion_c: "They speaking Spanish",
                respuesta_correcta: "B",
                explicacion: "Con 'they' usamos el verbo base sin agregar 's'.",
                ejemplo: "They speak Spanish fluently.",
                categoria: "Common Mistake",
                orden: 19
            },
            {
                pregunta: "¿Cómo se dice '¿Te gusta el chocolate?'?",
                opcion_a: "Do you like chocolate?",
                opcion_b: "You like chocolate?",
                opcion_c: "Are you like chocolate?",
                respuesta_correcta: "A",
                explicacion: "Usamos 'Do you like' para preguntar preferencias.",
                ejemplo: "Do you like chocolate? I love it!",
                categoria: "Speaking",
                orden: 20
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'I'm sorry'?",
                opcion_a: "It's okay",
                opcion_b: "No problem",
                opcion_c: "Don't worry",
                respuesta_correcta: "B",
                explicion: "'No problem' es la respuesta más común y natural.",
                ejemplo: "I'm sorry. No problem, it happens.",
                categoria: "Natural English",
                orden: 21
            },
            {
                pregunta: "¿Cómo se traduce '¿Puedo ir al baño?'?",
                opcion_a: "Can I go to the bathroom?",
                opcion_b: "May I go to the bathroom?",
                opcion_c: "Could I go to the bathroom?",
                respuesta_correcta: "A",
                explicacion: "'Can I' es más común y directo para pedir permiso.",
                ejemplo: "Can I go to the bathroom, please?",
                categoria: "Speaking",
                orden: 22
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Nosotros fuimos al cine'?",
                opcion_a: "We went to the cinema",
                opcion_b: "We go to the cinema",
                opcion_c: "We have gone to the cinema",
                respuesta_correcta: "A",
                explicacion: "Para pasado usamos el verbo irregular 'went' de 'go'.",
                ejemplo: "We went to the cinema last night.",
                categoria: "Common Mistake",
                orden: 23
            },
            {
                pregunta: "¿Cómo se dice '¿Cuándo naciste?'?",
                opcion_a: "When you born?",
                opcion_b: "When did you born?",
                opcion_c: "When were you born?",
                respuesta_correcta: "C",
                explicacion: "Para preguntas en pasado usamos 'were you born' con auxiliar.",
                ejemplo: "When were you born? In 1990.",
                categoria: "Speaking",
                orden: 24
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'Ella está cansada'?",
                opcion_a: "She is tired",
                opcion_b: "She tired",
                opcion_c: "She's tired",
                respuesta_correcta: "C",
                explicacion: "La contracción 'She's' es más natural que 'She is'.",
                ejemplo: "She's tired after work.",
                categoria: "Natural English",
                orden: 25
            },
            {
                pregunta: "¿Cómo se traduce '¿Puedo tener un vaso de agua?'?",
                opcion_a: "Can I have a glass of water?",
                opcion_b: "Can I have glass of water?",
                opcion_c: "May I have a glass of water?",
                respuesta_correcta: "A",
                explicacion: "'Can I have' es la forma más común para pedir algo.",
                ejemplo: "Can I have a glass of water, please?",
                categoria: "Speaking",
                orden: 26
            },
            {
                pregunta: "¿Cuál es la forma correcta de decir 'No lo tengo'?",
                opcion_a: "I don't have it",
                opcion_b: "I not have it",
                opcion_c: "I haven't it",
                respuesta_correcta: "A",
                explicacion: "Usamos 'don't have' para negar posesión en presente.",
                ejemplo: "I don't have my phone.",
                categoria: "Common Mistake",
                orden: 27
            },
            {
                pregunta: "¿Cómo se dice '¿Tienes tiempo?'?",
                opcion_a: "Do you have time?",
                opcion_b: "Have you time?",
                opcion_c: "Are you have time?",
                respuesta_correcta: "A",
                explicacion: "Para preguntar posesión usamos 'Do you have' con auxiliar.",
                ejemplo: "Do you have time to talk?",
                categoria: "Speaking",
                orden: 28
            },
            {
                pregunta: "¿Cuál es la respuesta más natural a 'Good luck'?",
                opcion_a: "Thanks",
                opcion_b: "Good luck too",
                opcion_c: "Thank you",
                respuesta_correcta: "C",
                explicacion: "'Thank you' es la respuesta más común a 'Good luck'.",
                ejemplo: "Good luck! Thank you.",
                categoria: "Natural English",
                orden: 29
            },
            {
                pregunta: "¿Cómo se traduce 'Estoy emocionado'?",
                opcion_a: "I'm excited",
                opcion_b: "I excited",
                opcion_c: "I am exciting",
                respuesta_correcta: "A",
                explicacion: "Usamos 'I'm' + adjetivo para describir emociones.",
                ejemplo: "I'm excited about the trip!",
                categoria: "Vocabulary",
                orden: 30
            }
        ];

        for (const desafio of desafios) {
            await adapter.pgPool.query(
                'INSERT INTO desafios_diarios (pregunta, opcion_a, opcion_b, opcion_c, respuesta_correcta, explicacion, ejemplo, categoria, orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [desafio.pregunta, desafio.opcion_a, desafio.opcion_b, desafio.opcion_c, desafio.respuesta_correcta, desafio.explicacion, desafio.ejemplo, desafio.categoria, desafio.orden]
            );
        }
        console.log('30 desafíos diarios creados en la base de datos');
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