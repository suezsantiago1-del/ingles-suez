import pg from 'pg';

class DatabaseAdapter {
    constructor() {
        this.pgPool = new pg.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
    }

    async run(sql, params = []) {
        let paramIndex = 1;
        const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        const res = await this.pgPool.query(pgSql, params);
        return { lastID: res.rows[0] ? res.rows[0].id : null, changes: res.rowCount };
    }

    async all(sql, params = []) {
        let paramIndex = 1;
        const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        const res = await this.pgPool.query(pgSql, params);
        return res.rows;
    }

    async get(sql, params = []) {
        let paramIndex = 1;
        const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        const res = await this.pgPool.query(pgSql, params);
        return res.rows[0];
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
            password VARCHAR(255) NOT NULL
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
    `);

    await adapter.pgPool.query(`ALTER TABLE cursos ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255);`);

    // Insertar Cursos iniciales si no existen
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

    // Limpiar lecciones anteriores de la Clase 1 e insertar la nueva estructura sin emojis
    await adapter.pgPool.query("DELETE FROM lecciones WHERE curso_id = 1");

    const contenidoClase1 = `
        <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
            
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">FASE DE PRÁCTICA INTERACTIVA</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Ejercicios de Alto Rendimiento</h2>
            </header>

            <!-- FASE 1 -->
            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: El Universo de los Saludos y Contextos</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 1.1: Simulación de Contextos Reales (Elección Múltiple)</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee atentamente las 5 situaciones e identifica el saludo o despedida adecuado según la hora y la formalidad del contexto.</p>

                    <ol style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem;">
                        <li style="margin-bottom: 1rem;">
                            Son las 08:30 AM. Entrás a una oficina corporativa a una entrevista de trabajo.<br>
                            <span style="font-family: monospace; color: #2b6cb0;">( A ) Good morning! | ( B ) Hi! | ( C ) Good evening!</span>
                        </li>
                        <li style="margin-bottom: 1rem;">
                            Son las 13:15 PM. Saludás a un mozo al entrar a almorzar.<br>
                            <span style="font-family: monospace; color: #2b6cb0;">( A ) Good night! | ( B ) Good afternoon! | ( C ) See you later!</span>
                        </li>
                        <li style="margin-bottom: 1rem;">
                            Son las 20:00 PM. Te encontrás con tus amigos en un bar para cenar.<br>
                            <span style="font-family: monospace; color: #2b6cb0;">( A ) Good night! | ( B ) Bye! | ( C ) Good evening!</span>
                        </li>
                        <li style="margin-bottom: 1rem;">
                            Son las 23:30 PM. Te retirás de una reunión de trabajo para irte a dormir a tu casa.<br>
                            <span style="font-family: monospace; color: #2b6cb0;">( A ) Good evening! | ( B ) Good night! | ( C ) Good morning!</span>
                        </li>
                        <li style="margin-bottom: 1rem;">
                            Te cruzás a un compañero de la facultad en el pasillo a las 16:00 PM y ambos van apurados a clases distintas.<br>
                            <span style="font-family: monospace; color: #2b6cb0;">( A ) Hi, see you later! | ( B ) Good night, nice to meet you! | ( C ) Good morning!</span>
                        </li>
                    </ol>

                    <div style="background: #f7fafc; border: 1px dashed #cbd5e0; padding: 0.8rem; border-radius: 6px; margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; color: #718096;">[ Contador de lectura / resolución activo ]</span>
                        <span style="font-size: 0.85rem; font-weight: 600; color: #2b6cb0;">Puntuación asignada: 20 pts</span>
                    </div>

                    <details style="margin-top: 1.2rem;">
                        <summary style="background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem; text-align: center; list-style: none;">
                            PASAR A FASE DE RESPUESTA (Validar Intento)
                        </summary>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 1.2rem; border-radius: 0 0 6px 6px; margin-top: -4px;">
                            <h5 style="margin-top: 0; color: #0b2238; font-size: 1rem; border-bottom: 1px solid #cbd5e0; padding-bottom: 0.4rem;">Clave de Respuestas y Diagnóstico:</h5>
                            <ul style="line-height: 1.7; font-size: 0.95rem; color: #2d3748; padding-left: 1.2rem;">
                                <li><strong>( A ) Good morning!</strong> &rarr; Contexto formal por la mañana.</li>
                                <li><strong>( B ) Good afternoon!</strong> &rarr; Pasado el mediodía (12:00 PM).</li>
                                <li><strong>( C ) Good evening!</strong> &rarr; Saludo de llegada por la noche. (Jamás usar Good night para saludar).</li>
                                <li><strong>( B ) Good night!</strong> &rarr; Despedida definitiva nocturna para ir a descansar.</li>
                                <li><strong>( A ) Hi, see you later!</strong> &rarr; Saludo informal rápido y despedida corta de pasillo.</li>
                            </ul>
                            <div style="margin-top: 1rem; padding: 0.6rem 1rem; background: #f0fff4; border: 1px solid #c6f6d5; border-radius: 4px; color: #22543d; font-size: 0.85rem; font-weight: bold; display: flex; justify-content: space-between;">
                                <span>Estado del Ejercicio: COMPLETADO</span>
                                <span>Progreso actualizado: 20%</span>
                            </div>
                        </div>
                    </details>
                </div>
            </section>

            <!-- FASE 2 -->
            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Laboratorio Intensivo del Verbo To Be</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                </div>

                <!-- Ejercicio 2.1 -->
                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 2.1: Transformación de Oraciones y Detección de Errores</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Realiza las transformaciones solicitadas y detecta las fallas gramaticales. Resuelve el bloque completo antes de revelar la validación.</p>

                    <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Completa con am, is o are:</h5>
                    <ol style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                        <li>She ________ a talented designer from Córdoba.</li>
                        <li>Carlos and I ________ ready for the exam.</li>
                        <li>They ________ not at home right now.</li>
                        <li>You ________ very good at learning languages.</li>
                    </ol>

                    <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Corrige el error en cada oración:</h5>
                    <ol start="5" style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem;">
                        <li>"I have 26 years old."</li>
                        <li>"He are a manager in a big company."</li>
                        <li>"Not am tired today."</li>
                        <li>"Is they happy with the project?"</li>
                    </ol>

                    <div style="background: #f7fafc; border: 1px dashed #cbd5e0; padding: 0.8rem; border-radius: 6px; margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; color: #718096;">[ Contador de lectura / resolución activo ]</span>
                        <span style="font-size: 0.85rem; font-weight: 600; color: #2b6cb0;">Puntuación asignada: 30 pts</span>
                    </div>

                    <details style="margin-top: 1.2rem;">
                        <summary style="background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem; text-align: center; list-style: none;">
                            PASAR A FASE DE RESPUESTA (Validar Intento)
                        </summary>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 1.2rem; border-radius: 0 0 6px 6px; margin-top: -4px;">
                            <h5 style="margin-top: 0; color: #0b2238; font-size: 1rem; border-bottom: 1px solid #cbd5e0; padding-bottom: 0.4rem;">Validación del Bloque:</h5>
                            
                            <p style="font-weight: bold; color: #184168; margin-bottom: 0.3rem;">Respuestas Parte I:</p>
                            <p style="font-family: monospace; background: #edf2f7; padding: 0.6rem; border-radius: 4px; color: #2d3748;">1. is | 2. are (Carlos y yo = We) | 3. are | 4. are</p>

                            <p style="font-weight: bold; color: #184168; margin-bottom: 0.3rem; margin-top: 1rem;">Correcciones Parte II:</p>
                            <ul style="line-height: 1.7; font-size: 0.95rem; color: #2d3748; padding-left: 1.2rem;">
                                <li><strong>5. I am 26 years old.</strong> (La edad en inglés se ES, no se tiene).</li>
                                <li><strong>6. He is a manager in a big company.</strong> (He va obligatoriamente con is).</li>
                                <li><strong>7. I am not tired today.</strong> (Se requiere el sujeto I y el verbo am antes del not).</li>
                                <li><strong>8. Are they happy with the project?</strong> (They requiere el auxiliar Are para preguntar).</li>
                            </ul>

                            <div style="margin-top: 1rem; padding: 0.6rem 1rem; background: #f0fff4; border: 1px solid #c6f6d5; border-radius: 4px; color: #22543d; font-size: 0.85rem; font-weight: bold; display: flex; justify-content: space-between;">
                                <span>Estado del Ejercicio: COMPLETADO</span>
                                <span>Progreso actualizado: 50%</span>
                            </div>
                        </div>
                    </details>
                </div>

                <!-- Ejercicio 2.2 -->
                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 2.2: Traducción Compleja de Escenarios</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Traduce este diálogo completo al inglés respetando las estructuras de afirmación, negación y pregunta.</p>

                    <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin: 1rem 0;">
                        <p style="margin: 0;"><strong>Persona A:</strong> "¡Hola! Buenas tardes. ¿Cómo estás?"</p>
                        <p style="margin: 0;"><strong>Persona B:</strong> "Hola, estoy muy bien, ¿y vos? ¿Sos estudiante acá?"</p>
                        <p style="margin: 0;"><strong>Persona A:</strong> "No, no soy estudiante, soy profesor. Pero ellos sí son estudiantes."</p>
                    </div>

                    <div style="background: #f7fafc; border: 1px dashed #cbd5e0; padding: 0.8rem; border-radius: 6px; margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; color: #718096;">[ Contador de lectura / resolución activo ]</span>
                        <span style="font-size: 0.85rem; font-weight: 600; color: #2b6cb0;">Puntuación asignada: 30 pts</span>
                    </div>

                    <details style="margin-top: 1.2rem;">
                        <summary style="background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem; text-align: center; list-style: none;">
                            PASAR A FASE DE RESPUESTA (Validar Intento)
                        </summary>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; padding: 1.2rem; border-radius: 0 0 6px 6px; margin-top: -4px;">
                            <h5 style="margin-top: 0; color: #0b2238; font-size: 1rem; border-bottom: 1px solid #cbd5e0; padding-bottom: 0.4rem;">Validación del Diálogo:</h5>
                            <div style="font-family: monospace; font-size: 0.95rem; line-height: 1.8; color: #2d3748; background: #edf2f7; padding: 0.8rem; border-radius: 4px;">
                                <p style="margin: 0;"><strong>Persona A:</strong> "Hello! Good afternoon. How are you?"</p>
                                <p style="margin: 0;"><strong>Persona B:</strong> "Hi, I'm very good, and you? Are you a student here?"</p>
                                <p style="margin: 0;"><strong>Persona A:</strong> "No, I'm not a student, I am a teacher. But they are students."</p>
                            </div>
                            <div style="margin-top: 1rem; padding: 0.6rem 1rem; background: #f0fff4; border: 1px solid #c6f6d5; border-radius: 4px; color: #22543d; font-size: 0.85rem; font-weight: bold; display: flex; justify-content: space-between;">
                                <span>Estado del Ejercicio: COMPLETADO</span>
                                <span>Progreso actualizado: 80%</span>
                            </div>
                        </div>
                    </details>
                </div>
            </section>

            <!-- ENTREGABLE FINAL -->
            <section class="bloque-fase" style="margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                </div>

                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 1</h4>
                        <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Redactá un texto de presentación personal de mínimo 6 oraciones (o enviá una nota de audio de 45 segundos leyéndolo) donde incluyas obligatoriamente los siguientes elementos:</p>

                    <ol style="line-height: 1.7; color: #4a5568; font-size: 0.95rem; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                        <li>Un saludo formal de acuerdo con el momento en que escribís el ejercicio.</li>
                        <li>Tu nombre completo y tu edad (utilizando la estructura correcta con el Verbo To Be).</li>
                        <li>Tu ciudad o país de origen.</li>
                        <li>Tu ocupación o profesión.</li>
                        <li>Una oración en negativo sobre cómo te sentís hoy (ejemplo: no estar cansado, no estar nervioso/a).</li>
                        <li>Una pregunta dirigida al profesor usando el Verbo To Be (ejemplo: preguntarle si está listo/a o si es de Argentina).</li>
                    </ol>

                    <div style="margin-top: 1.5rem;">
                        <textarea placeholder="Escribe aquí tu entrega de texto para la revisión del profesor..." style="width: 100%; height: 120px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; font-family: inherit; font-size: 0.95rem; margin-bottom: 1rem; resize: vertical;"></textarea>
                        
                        <div style="display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;">
                            <button type="button" style="background: #edf2f7; color: #2d3748; border: 1px solid #cbd5e0; padding: 0.7rem 1.2rem; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9rem;">
                                [ CAJA DE TEXTO / BOTÓN SUBIR AUDIO ]
                            </button>
                            <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
                                ENVIAR A REVISIÓN MANUAL
                            </button>
                        </div>
                    </div>
                </div>
            </section>

        </div>
    `;

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 1: Saludos, Presentaciones y el Verbo To Be', 'Módulo 1', 1, '', contenidoClase1]);

    return adapter;
})();

export default dbPromise;