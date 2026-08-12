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

    // Cursos iniciales
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

    // Resetear lecciones del Curso 1
    await adapter.pgPool.query("DELETE FROM lecciones WHERE curso_id = 1");

    // ==========================================
    // CLASE 1 - INTERACTIVA
    // ==========================================
    const contenidoClase1 = `
        <div class="clase-contenido" style="color: #1a202c;">
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">MÓDULO INTERACTIVO</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 1: Saludos, Presentaciones y Verbo To Be</h2>
            </header>

            <!-- FASE 1 -->
            <section style="margin-bottom: 3rem;">
                <div style="background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem;">FASE 1: El Universo de los Saludos y Contextos</h3>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h4>Ejercicio 1.1: Simulación de Contextos Reales</h4>
                    <p style="color: #4a5568;">Selecciona la opción correcta para cada situación:</p>

                    <!-- Pregunta 1 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Son las 08:30 AM. Entrás a una oficina a una entrevista de trabajo:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'f1_1', 'Good morning es el saludo formal indicado para la mañana.')">( A ) Good morning!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_1', 'Hi es demasiado informal para una entrevista formal.')">( B ) Hi!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_1', 'Good evening se usa al llegar por la noche.')">( C ) Good evening!</button>
                        <div id="f1_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 2 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>2. Son las 20:00 PM. Te encontrás con tus amigos en un bar para cenar:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_2', 'Good night no se usa para saludar al llegar, es solo una despedida.')">( A ) Good night!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_2', 'Bye es para despedirse, no para saludar al llegar.')">( B ) Bye!</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'f1_2', 'Good evening es el saludo correcto para llegar de noche.')">( C ) Good evening!</button>
                        <div id="f1_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <!-- FASE 2 -->
            <section style="margin-bottom: 3rem;">
                <div style="background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem;">FASE 2: Laboratorio del Verbo To Be</h3>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem;">
                    <h4>Ejercicio 2.1: Detección de Errores Gramaticales</h4>

                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>¿Cuál es la corrección correcta para: "She are a doctor"?</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f2_1', 'She am es incorrecto, am solo se usa con I.')">( A ) She am a doctor.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'f2_1', 'She es tercera persona singular y exige el verbo is.')">( B ) She is a doctor.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f2_1', 'She be no es la conjugación del presente simple.')">( C ) She be a doctor.</button>
                        <div id="f2_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <!-- ENTREGABLE FINAL -->
            <section style="margin-bottom: 2rem;">
                <div style="background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem;">ENTREGABLE FINAL — Clase 1</h3>
                </div>
                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem;">
                    <p>Redacta un texto de presentación personal (mínimo 6 oraciones) con tu saludo, nombre, edad, origen y ocupación:</p>
                    <textarea placeholder="Escribe tu respuesta aquí..." style="width: 100%; height: 100px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; margin-bottom: 1rem;"></textarea>
                    <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer;">ENVIAR A REVISIÓN</button>
                </div>
            </section>
        </div>
    `;

    // ==========================================
    // CLASE 2 - INTERACTIVA
    // ==========================================
    const contenidoClase2 = `
        <div class="clase-contenido" style="color: #1a202c;">
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold;">MÓDULO INTERACTIVO</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 2: Rutinas y Presente Simple</h2>
            </header>

            <section style="margin-bottom: 3rem;">
                <div style="background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem;">FASE 1: Conjugación de Tercera Persona</h3>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem;">
                    <h4>Ejercicio 1.1: Elección Múltiple de Hábitos</h4>

                    <!-- Pregunta 1 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Carlos trabaja desde su casa todos los días:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_1', 'Work falta agregar la -s de tercera persona (He).')">( A ) Carlos work from home every day.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c2_1', 'Works es la conjugación correcta en tercera persona afirmativa.')">( B ) Carlos works from home every day.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_1', 'Working es presente continuo, no presente simple de rutina.')">( C ) Carlos working from home every day.</button>
                        <div id="c2_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 2 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>2. Querés contar que tus hermanos no comen carne:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_2', 'Doesn\'t se usa solo para He/She/It. My brothers es plural (They).')">( A ) My brothers doesn't eat meat.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c2_2', 'Don\'t es el auxiliar negativo correcto para They.')">( B ) My brothers don't eat meat.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_2', 'Falta el auxiliar do/does para formar la negación.')">( C ) My brothers not eat meat.</button>
                        <div id="c2_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <!-- ENTREGABLE FINAL -->
            <section style="margin-bottom: 2rem;">
                <div style="background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem;">ENTREGABLE FINAL — Clase 2</h3>
                </div>
                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem;">
                    <p>Escribe 6 oraciones describiendo tu rutina diaria y la de un familiar o amigo:</p>
                    <textarea placeholder="Escribe tu rutina aquí..." style="width: 100%; height: 100px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; margin-bottom: 1rem;"></textarea>
                    <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer;">ENVIAR A REVISIÓN</button>
                </div>
            </section>
        </div>
    `;

    // Cargar ambas clases en la base de datos
    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 1: Saludos, Presentaciones y el Verbo To Be', 'Módulo 1', 1, '', contenidoClase1]);

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 2: Rutinas, Hábitos y el Presente Simple', 'Módulo 1', 2, '', contenidoClase2]);

    return adapter;
})();

export default dbPromise;