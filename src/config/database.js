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
    
    // Crear tablas
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

    // Insertar Cursos si no existen
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

    // Limpiar lecciones anteriores e insertar la nueva estructura de Retos
    await adapter.pgPool.query("DELETE FROM lecciones WHERE curso_id = 1");

    const contenidoClase1 = `
        <div class="clase-contenido">
            
            <!-- FASE 1 -->
            <section class="bloque-fase" style="margin-bottom: 2.5rem;">
                <h2 style="color: #0b2238; border-bottom: 2px solid #184168; padding-bottom: 0.5rem;">FASE 1: EL BLOQUE DE SALUDOS Y CONTEXTO</h2>
                <p style="color: #4a5568; font-style: italic;">Lee la situación o pregunta. Piensa la respuesta antes de hacer clic para revelar la solución.</p>
                
                <div class="ejercicio-card" style="background: white; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #184168; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-top: 1rem;">
                    <h3>🕹️ Reto 1.1: El Dilema del Reloj</h3>
                    <p><strong>Situación:</strong> Son las 19:30 horas (7:30 PM). Te encuentras con un colega en la calle al salir de trabajar y quieres saludarlo correctamente.</p>
                    <p>¿Cuál de las siguientes opciones es la correcta para iniciar el saludo?</p>
                    <ul>
                        <li><strong>[ A ]</strong> Good night!</li>
                        <li><strong>[ B ]</strong> Good evening!</li>
                        <li><strong>[ C ]</strong> Good afternoon!</li>
                    </ul>
                    
                    <details style="margin-top: 1.5rem; background: #e3edf5; padding: 1rem; border-radius: 6px; cursor: pointer;">
                        <summary style="font-weight: bold; color: #0b2238;">🔍 Revelar Respuesta y Validación (Pantalla B)</summary>
                        <div style="margin-top: 1rem; color: #1a202c; line-height: 1.6;">
                            <p style="color: #2b6cb0; font-weight: bold;">🛑 ¡Respuesta Correcta: [ B ] Good evening!</p>
                            <p><strong>Por qué es un reto:</strong> Caer en la trampa de <em>Good night</em> es el error número uno. Aunque ya sea de noche, <em>Good night</em> es exclusivamente una despedida para ir a dormir. Al llegar y saludar a las 19:30, el código correcto es <strong>Good evening</strong>.</p>
                        </div>
                    </details>
                </div>
            </section>

            <!-- FASE 2 -->
            <section class="bloque-fase" style="margin-bottom: 2.5rem;">
                <h2 style="color: #0b2238; border-bottom: 2px solid #184168; padding-bottom: 0.5rem;">FASE 2: EL LABORATORIO DEL VERBO TO BE</h2>
                
                <div class="ejercicio-card" style="background: white; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #184168; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-top: 1rem;">
                    <h3>🕹️ Reto 2.1: El Cazador de Errores (Nivel: Difícil)</h3>
                    <p><strong>El Desafío:</strong> La siguiente oración escrita por un estudiante tiene un error crítico de estructura en el Verbo To Be:</p>
                    <blockquote style="background: #fff5f5; border-left: 3px solid #e53e3e; padding: 0.8rem 1rem; color: #c53030; font-style: italic;">
                        "She are a very intelligent doctor, but not am working today."
                    </blockquote>
                    <p>Analiza la frase mentalmente. Identifica cuántos errores tiene y cuál es la versión perfecta antes de ver la solución.</p>
                    
                    <details style="margin-top: 1.5rem; background: #e3edf5; padding: 1rem; border-radius: 6px; cursor: pointer;">
                        <summary style="font-weight: bold; color: #0b2238;">🔍 Revelar Diagnóstico y Solución (Pantalla B)</summary>
                        <div style="margin-top: 1rem; color: #1a202c; line-height: 1.6;">
                            <p style="color: #c53030; font-weight: bold;">🛑 Diagnóstico del Reto: La oración original tenía dos errores graves.</p>
                            <ul>
                                <li><strong>Error 1:</strong> <code>She are</code> &rarr; El pronombre <em>She</em> exige obligatoriamente <strong>is</strong>.</li>
                                <li><strong>Error 2:</strong> <code>not am working</code> &rarr; En inglés no se puede iniciar una negación soltando el <em>not am</em> sin un sujeto y verbo auxiliar estructurado.</li>
                            </ul>
                            <p style="background: #f0fff4; border: 1px solid #c6f6d5; padding: 0.8rem; border-radius: 6px; color: #22543d; font-weight: bold;">
                                ✨ La Oración Corregida: "She is a very intelligent doctor, but she is not working today." (o su forma compacta: isn't working).
                            </p>
                        </div>
                    </details>
                </div>

                <div class="ejercicio-card" style="background: white; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #184168; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-top: 1.5rem;">
                    <h3>🕹️ Reto 2.2: Traducción Cruzada a Contrarreloj</h3>
                    <p><strong>El Desafío:</strong> Traduce mentalmente esta frase del español al inglés antes de que pasen 10 segundos. No puedes usar ayudas visuales:</p>
                    <blockquote style="background: #edf2f7; padding: 0.8rem 1rem; border-radius: 4px; font-weight: bold; color: #2d3748;">
                        "¿Estás cansado hoy? No, no estoy cansado, estoy muy feliz."
                    </blockquote>
                    <p>Escribe tu versión en un papel o dila en voz alta antes de revelar.</p>
                    
                    <details style="margin-top: 1.5rem; background: #e3edf5; padding: 1rem; border-radius: 6px; cursor: pointer;">
                        <summary style="font-weight: bold; color: #0b2238;">🔍 Revelar Validación NAtiva (Pantalla B)</summary>
                        <div style="margin-top: 1rem; color: #1a202c; line-height: 1.6;">
                            <p style="color: #2b6cb0; font-weight: bold;">🛑 Validación del Reto: Compara tu estructura con la forma nativa ideal:</p>
                            <p style="font-size: 1.1rem; font-family: monospace; background: #2d3748; color: #63b3ed; padding: 0.8rem; border-radius: 6px;">
                                "Are you tired today? No, I'm not tired, I am very happy."
                            </p>
                            <p><strong>Criterio de Victoria:</strong> Si invertiste el orden en la pregunta (<em>Are you</em> en vez de <em>You are</em>) y usaste la contracción correcta en la negativa (<em>I'm not</em>), superaste el reto con éxito.</p>
                        </div>
                    </details>
                </div>
            </section>

            <!-- FASE 3 -->
            <section class="bloque-fase" style="margin-bottom: 2.5rem;">
                <h2 style="color: #0b2238; border-bottom: 2px solid #184168; padding-bottom: 0.5rem;">FASE 3: EL JUICIO FINAL DE LA CLASE (Prueba de Fuego)</h2>
                
                <div class="ejercicio-card" style="background: #0b2238; color: white; padding: 1.8rem; border-radius: 8px; box-shadow: 0 6px 12px rgba(0,0,0,0.15);">
                    <h3 style="color: #a4c4de; margin-top: 0;">🕹️ Reto 3.1: La Presentación Ejecutiva en Vivo</h3>
                    <p><strong>Situación de Alta Exigencia:</strong> Estás frente al CEO de una multinacional de forma imprevista. Tienes que presentarte combinando identidad, procedencia y estado actual en exactamente tres oraciones sin dudar.</p>
                    <p style="color: #cbd5e0;">Diseña tu estructura en tu mente usando la teoría de la clase antes de activar la validación.</p>
                    
                    <details style="margin-top: 1.5rem; background: #184168; padding: 1rem; border-radius: 6px; cursor: pointer; color: white;">
                        <summary style="font-weight: bold; color: #a4c4de;">🔍 Revelar Modelo de Referencia Estándar (Pantalla B)</summary>
                        <div style="margin-top: 1rem; color: #e2e8f0; line-height: 1.6;">
                            <p style="color: #68d391; font-weight: bold;">🛑 Modelo de Referencia Estándar:</p>
                            <ol style="line-height: 1.8;">
                                <li><strong>Hello, good morning.</strong> (Saludo temporal correcto)</li>
                                <li><strong>My name is [Tu Nombre] and I am from Argentina.</strong> (Identidad + Verbo To Be)</li>
                                <li><strong>I am ready for this project.</strong> (Estado con To Be afirmativo)</li>
                            </ol>
                            <p style="background: rgba(255,255,255,0.1); padding: 0.8rem; border-radius: 6px; font-style: italic;">
                                🏆 <strong>Reto cumplido:</strong> Si lograste decirlo fluido y sin mezclar <em>have</em> con la edad o <em>are</em> con la tercera persona, has desbloqueado el nivel completo de la Clase 1.
                            </p>
                        </div>
                    </details>
                </div>
            </section>

        </div>
    `;

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 1: Módulo Interactivo de Retos', 'Módulo 1', 1, '', contenidoClase1]);

    return adapter;
})();

export default dbPromise;