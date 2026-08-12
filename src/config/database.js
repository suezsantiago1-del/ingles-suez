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
            leida BOOLEAN DEFAULT FALSE,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Limpiar lecciones anteriores del Curso 1 para recargar 1, 2, 3, 4 y 5
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

            <section style="margin-bottom: 3rem;">
                <div style="background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem;">FASE 1: El Universo de los Saludos y Contextos</h3>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h4>Ejercicio 1.1: Simulación de Contextos Reales</h4>
                    <p style="color: #4a5568;">Selecciona la opción correcta para cada situación:</p>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Son las 08:30 AM. Entrás a una oficina a una entrevista de trabajo:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'f1_1', 'Good morning es el saludo formal indicado para la mañana.')">( A ) Good morning!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_1', 'Hi es demasiado informal para una entrevista formal.')">( B ) Hi!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_1', 'Good evening se usa al llegar por la noche.')">( C ) Good evening!</button>
                        <div id="f1_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>2. Son las 20:00 PM. Te encontrás con tus amigos en un bar para cenar:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_2', 'Good night no se usa para saludar al llegar, es solo una despedida.')">( A ) Good night!</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'f1_2', 'Bye es para despedirse, no para saludar al llegar.')">( B ) Bye!</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'f1_2', 'Good evening es el saludo correcto para llegar de noche.')">( C ) Good evening!</button>
                        <div id="f1_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

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

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Carlos trabaja desde su casa todos los días:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_1', 'Work falta agregar la -s de tercera persona (He).')">( A ) Carlos work from home every day.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c2_1', 'Works es la conjugación correcta en tercera persona afirmativa.')">( B ) Carlos works from home every day.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_1', 'Working es presente continuo, no presente simple de rutina.')">( C ) Carlos working from home every day.</button>
                        <div id="c2_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>2. Querés contar que tus hermanos no comen carne:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_2', 'Doesn\'t se usa solo para He/She/It. My brothers es plural (They).')">( A ) My brothers doesn't eat meat.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c2_2', 'Don\'t es el auxiliar negativo correcto para They.')">( B ) My brothers don't eat meat.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c2_2', 'Falta el auxiliar do/does para formar la negación.')">( C ) My brothers not eat meat.</button>
                        <div id="c2_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

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

    // ==========================================
    // CLASE 3 - INTERACTIVA
    // ==========================================
    const contenidoClase3 = `
        <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
            
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">FASE DE PRÁCTICA INTERACTIVA</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Ejercicios de Alto Rendimiento — Clase 3</h2>
            </header>

            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Existencia y Ubicación (There is / There are y Preposiciones)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 1.1: Descripción de Espacios y Objetos (Elección Múltiple)</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee las 5 situaciones e identifica la forma correcta de expresar existencia (there is / there are) y ubicación espacial (in, on, at, under).</p>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Querés decir que hay una computadora sobre el escritorio de la oficina:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_1', 'There are es para plural. Computer es singular.')">( A ) There are a computer on the desk.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c3_1', 'There is se usa para singular y on indica sobre la superficie.')">( B ) There is a computer on the desk.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_1', 'In significa dentro del escritorio, no sobre la superficie.')">( C ) There is a computer in the desk.</button>
                        <div id="c3_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>2. Vas a avisar que hay varios documentos importantes dentro de la carpeta:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c3_2', 'There are para plural e in indica dentro del contenedor/carpeta.')">( A ) There are some important documents in the folder.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_2', 'Documents es plural, requiere There are.')">( B ) There is some important documents on the folder.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_2', 'Under significa debajo de la carpeta.')">( C ) There are some important documents under the folder.</button>
                        <div id="c3_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>3. Buscás tus llaves y tu hermano te avisa que no hay nada debajo de la mesa:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c3_3', 'Under es debajo y isn\'t anything evita la doble negación.')">( A ) There isn't anything under the table.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_3', 'Anything va con estructura singular en este contexto.')">( B ) There aren't anything on the table.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c3_3', 'Not nothing es una doble negación incorrecta en inglés.')">( C ) There is not nothing under the table.</button>
                        <div id="f3_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <section class="bloque-fase" style="margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                </div>

                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem;">
                    <p style="font-size: 0.95rem; color: #2d3748;">Redactá un texto descriptivo sobre tu espacio de trabajo o tu casa de mínimo 6 oraciones con There is/are, preposiciones y posesivos:</p>
                    <textarea placeholder="Escribe aquí tu entrega de texto..." style="width: 100%; height: 120px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; margin-bottom: 1rem;"></textarea>
                    <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer;">ENVIAR A REVISIÓN MANUAL</button>
                </div>
            </section>
        </div>
    `;

    // ==========================================
    // CLASE 4 - INTERACTIVA
    // ==========================================
    const contenidoClase4 = `
        <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
            
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">FASE DE PRÁCTICA INTERACTIVA</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Ejercicios de Alto Rendimiento — Clase 4</h2>
            </header>

            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Verbos Regulares e Irregulares en Pasado</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 1.1: Conjugación y Conectores Temporales (Elección Múltiple)</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee las 5 situaciones e identifica la forma verbal en Pasado Simple (Past Simple) y la expresión de tiempo correcta.</p>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Querés contar que ayer estudiaste inglés durante dos horas:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c4_1', 'Verbo regular: la consonante + y cambia a -ied (studied).')">( A ) Yesterday I studied English for two hours.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_1', 'Studyed es un error de ortografía, se debe cambiar la y por ied.')">( B ) Yesterday I studyed English for two hours.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_1', 'Study está en presente, no en pasado.')">( C ) Yesterday I study English for two hours.</button>
                        <div id="c4_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>2. Le contás a un amigo que el fin de semana pasado fuiste a Córdoba:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_2', 'Goed no existe, go es un verbo irregular.')">( A ) Last weekend I goed to Córdoba.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c4_2', 'Went es el pasado irregular correcto del verbo go.')">( B ) Last weekend I went to Córdoba.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_2', 'Was go no combina el verbo To Be con el infinitivo go.')">( C ) Last weekend I was go to Córdoba.</button>
                        <div id="c4_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>3. Querés decir que anoche no dormiste bien:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_3', 'Tras el auxiliar didn\'t el verbo debe ir en forma base (sleep), no slept.')">( A ) Last night I didn't slept well.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c4_3', 'Con didn\'t se utiliza el verbo en forma base (sleep).')">( B ) Last night I didn't sleep well.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_3', 'Wasn\'t no se utiliza para negar verbos de acción en pasado simple.')">( C ) Last night I wasn't sleep well.</button>
                        <div id="c4_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>4. Vas a preguntar si ella compró la computadora la semana pasada:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_4', 'En la pregunta con Did el verbo debe volver a su forma base (buy).')">( A ) Did she bought the computer last week?</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c4_4', 'Pregunta en pasado usa Did + verbo en forma base (buy).')">( B ) Did she buy the computer last week?</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_4', 'Does es un auxiliar de presente, no de pasado.')">( C ) Does she bought the computer last week?</button>
                        <div id="c4_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>5. Querés avisar que el proyecto empezó hace tres días:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c4_5', 'La expresión ago (hace) se coloca al final del período de tiempo.')">( A ) The project started three days ago.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_5', 'Ago debe ir después de la cantidad de tiempo (three days ago).')">( B ) The project started ago three days.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c4_5', 'Starts está en presente simple.')">( C ) The project starts three days ago.</button>
                        <div id="c4_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <section class="bloque-fase" style="margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                </div>

                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem;">
                    <p style="font-size: 0.95rem; color: #2d3748;">Redactá un texto en pasado sobre tu último fin de semana o tus últimas vacaciones con verbos regulares e irregulares:</p>
                    <textarea placeholder="Escribe aquí tu entrega de texto..." style="width: 100%; height: 120px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; margin-bottom: 1rem;"></textarea>
                    <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer;">ENVIAR A REVISIÓN MANUAL</button>
                </div>
            </section>
        </div>
    `;

    // ==========================================
    // CLASE 5 - INTERACTIVA
    // ==========================================
    const contenidoClase5 = `
        <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
            
            <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">FASE DE PRÁCTICA INTERACTIVA</span>
                <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Ejercicios de Alto Rendimiento — Clase 5</h2>
            </header>

            <!-- FASE 1 CLASE 5 -->
            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Planes e Intenciones (Be Going To)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                </div>

                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 1.1: Estructura de Planes e Intenciones (Elección Múltiple)</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee las 5 situaciones e identifica la forma correcta de expresar un plan futuro ya decidido usando la estructura Sujeto + Verbo To Be + going to + Verbo base.</p>

                    <!-- Pregunta 1 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>1. Querés contar que el mes que viene te vas a comprar un auto nuevo:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_1', 'Estructura completa: I + am + going to + verbo base (buy).')">( A ) Next month I am going to buy a new car.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_1', 'Falta el verbo To Be (am) antes de going to.')">( B ) Next month I going to buy a new car.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_1', 'La estructura requiere la palabra going, no el infinitivo go.')">( C ) Next month I am go to buy a new car.</button>
                        <div id="c5_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 2 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>2. Le contás a un compañero que Laura no va a asistir a la reunión de mañana:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_2', 'La negación se realiza sobre el verbo To Be (Laura is not / isn\'t), no con doesn\'t.')">( A ) Laura isn't going to attend the meeting tomorrow.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_2', 'Doesn\'t no se utiliza con la estructura going to.')">( B ) Laura doesn't going to attend the meeting tomorrow.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_2', 'Falta el auxiliar To Be (is) para formar la negación.')">( C ) Laura not going to attend the meeting tomorrow.</button>
                        <div id="c5_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 3 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>3. Querés preguntarle a un amigo si va a viajar a Bariloche en las vacaciones:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_3', 'Do no se utiliza para preguntar con going to.')">( A ) Do you going to travel to Bariloche on vacation?</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_3', 'Las preguntas invierten el verbo To Be al inicio (Are you...?).')">( B ) Are you going to travel to Bariloche on vacation?</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_3', 'Will y going to son dos estructuras de futuro distintas y no se mezclan.')">( C ) Will you going to travel to Bariloche on vacation?</button>
                        <div id="c5_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 4 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                        <p><strong>4. Vas a avisar que el equipo va a lanzar el nuevo sitio web el viernes:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_4', 'The team actúa como sujeto colectivo singular (It), requiere is.')">( A ) The team is going to launch the new website on Friday.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_4', 'Falta el verbo To Be y launches tiene un exceso de flexión en la s.')">( B ) The team going to launches the new website on Friday.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_4', 'Are go to no sigue la estructura oficial de Be going to.')">( C ) The team are go to launch the new website on Friday.</button>
                        <div id="c5_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>

                    <!-- Pregunta 5 -->
                    <div class="quiz-question" style="margin-bottom: 1.5rem;">
                        <p><strong>5. Querés decir que ustedes no van a trabajar este fin de semana largo:</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_5', 'Don\'t es un auxiliar de presente simple, no de futuro con going to.')">( A ) We don't going to work this long weekend.</button>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_5', 'We combina obligatoriamente con are not / aren\'t.')">( B ) We aren't going to work this long weekend.</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_5', 'Isn\'t se usa solo con He, She o It.')">( C ) We isn't going to work this long weekend.</button>
                        <div id="c5_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <!-- FASE 2 CLASE 5 -->
            <section class="bloque-fase" style="margin-bottom: 3rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                    <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Laboratorio Intensivo de Planes y Predicciones con Evidencia</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                </div>

                <!-- Ejercicio 2.1 -->
                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 2.1: Transformación y Detección de Errores Gramaticales</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Revisa las respuestas y correcciones gramaticales del laboratorio:</p>

                    <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Respuestas de selección:</h5>
                    <ol style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                        <li>Look at those dark clouds! It <strong>is going to rain</strong> in a few minutes. (Predicción con evidencia visible).</li>
                        <li>What <strong>are</strong> you <strong>going to do</strong> after work today? (Estructura interrogativa: Are + you + going to + do).</li>
                        <li>My brother <strong>isn't going to study</strong> medicine next year; he prefers engineering.</li>
                        <li>They <strong>are going to move</strong> to a new apartment next month.</li>
                    </ol>

                    <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Correcciones Gramaticales:</h5>
                    <ul style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem;">
                        <li>"I going to visit my grandmother this weekend." &rarr; <strong>I am going to visit my grandmother this weekend.</strong> (Faltaba el verbo am antes de going to).</li>
                        <li>"Is they going to start the course tomorrow?" &rarr; <strong>Are they going to start the course tomorrow?</strong> (They exige Are, no Is).</li>
                        <li>"She isn't going to travels to Europe next summer." &rarr; <strong>She isn't going to travel to Europe next summer.</strong> (El verbo principal tras going to se mantiene en forma base: travel, sin "s").</li>
                        <li>"Do you going to prepare the presentation for Monday?" &rarr; <strong>Are you going to prepare the presentation for Monday?</strong> (No se usa el auxiliar Do para preguntar con going to; se usa el verbo To Be).</li>
                    </ul>
                </div>

                <!-- Ejercicio 2.2 -->
                <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 2.2: Traducción Compleja de Planes a Futuro</h4>
                        <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Traduce este diálogo sobre proyectos futuros aplicando la estructura de be going to en afirmativo, negativo e interrogativo.</p>

                    <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin: 1rem 0;">
                        <p style="margin: 0;"><strong>Persona A:</strong> "¿Qué vas a hacer este fin de semana?"</p>
                        <p style="margin: 0;"><strong>Persona B:</strong> "Voy a descansar. No voy a trabajar el sábado ni el domingo."</p>
                        <p style="margin: 0;"><strong>Persona A:</strong> "¿Y tu hermano va a pintar la casa con vos?"</p>
                        <p style="margin: 0;"><strong>Persona B:</strong> "No, él va a viajar a Rosario a visitar a unos amigos."</p>
                    </div>

                    <div class="quiz-question" style="margin-top: 1.5rem;">
                        <p><strong>¿Cuál es la traducción correcta para el diálogo completo?</strong></p>
                        <button class="option-btn" onclick="checkAnswer(this, true, 'c5_dial', 'Traducción exacta respetando what are you going to do, I\'m not going to work e is your brother going to.')">( A ) A: "What are you going to do this weekend?" / B: "I am going to rest. I'm not going to work on Saturday or Sunday." / A: "And is your brother going to paint the house with you?" / B: "No, he is going to travel to Rosario to visit some friends."</button>
                        <button class="option-btn" onclick="checkAnswer(this, false, 'c5_dial', 'What you going to do y I don\'t going to work contienen errores de auxilares.')">( B ) A: "What you going to do this weekend?" / B: "I am going to rest. I don't going to work..."</button>
                        <div id="c5_dial" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                    </div>
                </div>
            </section>

            <!-- ENTREGABLE FINAL CLASE 5 -->
            <section class="bloque-fase" style="margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                    <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                </div>

                <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                        <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 5</h4>
                        <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                    </div>

                    <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Redactá un texto sobre tus planes personales o profesionales para los próximos meses de mínimo 6 oraciones (o enviá una nota de audio de 45 segundos leyéndolo) donde incluyas obligatoriamente los siguientes elementos:</p>

                    <ol style="line-height: 1.7; color: #4a5568; font-size: 0.95rem; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                        <li>Una oración en afirmativo sobre un plan personal futuro usando <em>I am going to + verbo base</em>.</li>
                        <li>Una oración en negativo sobre algo que decidiste NO hacer próximamente (<em>I'm not going to...</em>).</li>
                        <li>Una oración sobre los planes de otra persona (amigo, familiar o compañero) usando <em>He/She is going to...</em>.</li>
                        <li>Una oración sobre un proyecto en equipo o familiar usando <em>We are going to...</em>.</li>
                        <li>Al menos dos marcadores temporales de futuro (<em>tomorrow, next week, next month, soon, this weekend</em>).</li>
                        <li>Una pregunta sobre planes futuros dirigida al profesor usando la estructura <em>Are you going to...?</em> o <em>What are you going to...?</em>.</li>
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

    // Cargar las 5 clases en la base de datos
    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 1: Saludos, Presentaciones y el Verbo To Be', 'Módulo 1', 1, '', contenidoClase1]);

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 2: Rutinas, Hábitos y el Presente Simple', 'Módulo 1', 2, '', contenidoClase2]);

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 3: Describiendo el Entorno, Pertenencias y Expresiones de Cantidad', 'Módulo 1', 3, '', contenidoClase3]);

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 4: Pasado Simple (Acciones Pasadas y Experiencias)', 'Módulo 1', 4, '', contenidoClase4]);

    await adapter.run(`
        INSERT INTO lecciones (curso_id, titulo, modulo, orden, video_url, contenido_html)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [1, 'Clase 5: Futuro con Going To, Planes y Proyectos', 'Módulo 1', 5, '', contenidoClase5]);

    return adapter;
})();

export default dbPromise;