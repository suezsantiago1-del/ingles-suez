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

    // Insertar Clase 1 de Inglés Intensivo Desde Cero si la tabla está vacía
    const leccionesCount = await adapter.pgPool.query("SELECT COUNT(*) FROM lecciones WHERE curso_id = 1");
    if (parseInt(leccionesCount.rows[0].count) === 0) {
        const contenidoClase1 = `
            <div class="clase-contenido">
                <section class="bloque-teoria">
                    <h2>PARTE 1: Ficha de Teoría y Guía Rápida</h2>
                    
                    <h3>1. Saludos y Despedidas (Greetings & Farewells)</h3>
                    <p>Para empezar a hablar desde el primer día, memoriza estas expresiones esenciales según el momento del día:</p>
                    <ul>
                        <li><strong>Hello / Hi:</strong> Hola (Hi es más informal).</li>
                        <li><strong>Good morning:</strong> Buenos días (hasta el mediodía).</li>
                        <li><strong>Good afternoon:</strong> Buenas tardes (desde las 12:00 hasta las 18:00).</li>
                        <li><strong>Good evening:</strong> Buenas noches (al saludar al atardecer/noche).</li>
                        <li><strong>Good night:</strong> Buenas noches (exclusivamente para despedirse antes de dormir).</li>
                        <li><strong>Goodbye / Bye:</strong> Adiós.</li>
                        <li><strong>See you later:</strong> Nos vemos luego.</li>
                    </ul>

                    <h3>2. Presentándose (Introducing Yourself)</h3>
                    <ul>
                        <li><strong>What is your name?</strong> (¿Cómo te llamas?) &rarr; <em>My name is [Tu Nombre]</em> o <em>I am [Tu Nombre]</em>.</li>
                        <li><strong>Nice to meet you:</strong> Mucho gusto.</li>
                        <li><strong>And you?</strong> (¿Y tú?) / <strong>How are you?</strong> (¿Cómo estás?) &rarr; <em>I'm fine, thank you</em> (Estoy bien, gracias).</li>
                    </ul>

                    <h3>3. El Verbo To Be (Ser o Estar)</h3>
                    <p>El pilar fundamental del inglés. Así se conjuga en Presente Simple (Afirmativo):</p>
                    <div class="table-responsive">
                        <table class="tabla-gramatica">
                            <thead>
                                <tr>
                                    <th>Pronombre</th>
                                    <th>Verbo</th>
                                    <th>Ejemplo de uso</th>
                                    <th>Traducción</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td>I (Yo)</td><td>am</td><td>I am a student.</td><td>Yo soy un estudiante.</td></tr>
                                <tr><td>You (Tú / Ustedes)</td><td>are</td><td>You are intelligent.</td><td>Tú eres inteligente.</td></tr>
                                <tr><td>He (Él)</td><td>is</td><td>He is a teacher.</td><td>Él es un profesor.</td></tr>
                                <tr><td>She (Ella)</td><td>is</td><td>She is from Argentina.</td><td>Ella es de Argentina.</td></tr>
                                <tr><td>It (Eso / Objeto)</td><td>is</td><td>It is a book.</td><td>Es un libro.</td></tr>
                                <tr><td>We (Nosotros)</td><td>are</td><td>We are friends.</td><td>Nosotros somos amigos.</td></tr>
                                <tr><td>They (Ellos/as)</td><td>are</td><td>They are happy.</td><td>Ellos están felices.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <p><strong>Forma Negativa rápida:</strong> Solo se añade <em>not</em> después del verbo (I am not, You are not / aren't, He is not / isn't).</p>
                    <p><strong>Forma de Pregunta:</strong> Se invierte el orden (Am I...?, Are you...?, Is he...?).</p>
                </section>

                <section class="bloque-ejercicios">
                    <h2>PARTE 2: "El Desafío Gramatical"</h2>
                    
                    <div class="ejercicio-card">
                        <h4>Ejercicio 1: Completa los espacios (Fill in the gaps)</h4>
                        <p>Rellena con la forma correcta del verbo To Be (am, is, are):</p>
                        <ol>
                            <li>Maria _________ a doctor from Spain.</li>
                            <li>I _________ very happy today.</li>
                            <li>John and Peter _________ friends.</li>
                            <li>This _________ an English book.</li>
                            <li>You _________ a great student.</li>
                        </ol>
                        <details>
                            <summary>Ver Respuestas Correctas</summary>
                            <p>1. is | 2. am | 3. are | 4. is | 5. are</p>
                        </details>
                    </div>

                    <div class="ejercicio-card">
                        <h4>Ejercicio 2: Ordena la oración (Sentence Scramble)</h4>
                        <p>Ordena las palabras para formar una oración correcta:</p>
                        <ol>
                            <li>( is / name / My / Carlos )</li>
                            <li>( Argentina / am / I / from )</li>
                            <li>( are / students / We )</li>
                            <li>( she / Is / teacher / a / ? )</li>
                        </ol>
                        <details>
                            <summary>Ver Respuestas Correctas</summary>
                            <p>1. My name is Carlos.<br>2. I am from Argentina.<br>3. We are students.<br>4. Is she a teacher?</p>
                        </details>
                    </div>

                    <div class="ejercicio-card">
                        <h4>Ejercicio 3: Traducción exprés (Translate)</h4>
                        <ol>
                            <li>Hola, mi nombre es Ana.</li>
                            <li>Él no es un doctor.</li>
                            <li>¿Cómo estás? Estoy bien, gracias.</li>
                        </ol>
                        <details>
                            <summary>Ver Respuestas Correctas</summary>
                            <p>1. Hello, my name is Ana.<br>2. He is not a doctor (o He isn't a doctor).<br>3. How are you? I'm fine, thank you.</p>
                        </details>
                    </div>
                </section>

                <section class="bloque-audio">
                    <h2>PARTE 3: Tu Reto de Voz (Audio-práctica)</h2>
                    <p><strong>Instrucciones:</strong> Grábate con tu teléfono leyendo en voz alta el siguiente párrafo de presentación. Intenta imitar la entonación y respira en los puntos:</p>
                    <blockquote class="quote-reto">
                        "Hello! Good morning. My name is [Tu Nombre]. I am from Argentina. I am a student of English Suez. Nice to meet you!"
                    </blockquote>
                </section>
            </div>
        `;

        await adapter.run(`
            INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [1, 'Clase 1: Saludos, Presentaciones y el Verbo To Be', 'Módulo 1', 1, '', contenidoClase1]);
    }

    return adapter;
})();

export default dbPromise;