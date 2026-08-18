import pg from 'pg';

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

    // Lecciones iniciales (SOLO SI LA TABLA LECCIONES ESTÁ VACÍA)
    const countLecciones = await adapter.pgPool.query("SELECT COUNT(*) FROM lecciones");
    if (parseInt(countLecciones.rows[0].count) === 0) {

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

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. Querés contar que el mes que viene te vas a comprar un auto nuevo:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c5_1', 'Estructura completa: I + am + going to + verbo base (buy).')">( A ) Next month I am going to buy a new car.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_1', 'Falta el verbo To Be (am) antes de going to.')">( B ) Next month I going to buy a new car.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_1', 'La estructura requiere la palabra going, no el infinitivo go.')">( C ) Next month I am go to buy a new car.</button>
                            <div id="c5_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Le contás a un compañero que Laura no va a asistir a la reunión de mañana:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c5_2', 'La negación se realiza sobre el verbo To Be (Laura is not / isn\'t), no con doesn\'t.')">( A ) Laura isn't going to attend the meeting tomorrow.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_2', 'Doesn\'t no se utiliza con la estructura going to.')">( B ) Laura doesn't going to attend the meeting tomorrow.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_2', 'Falta el auxiliar To Be (is) para formar la negación.')">( C ) Laura not going to attend the meeting tomorrow.</button>
                            <div id="c5_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. Querés preguntarle a un amigo si va a viajar a Bariloche en las vacaciones:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_3', 'Do no se utiliza para preguntar con going to.')">( A ) Do you going to travel to Bariloche on vacation?</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c5_3', 'Las preguntas invierten el verbo To Be al inicio (Are you...?).')">( B ) Are you going to travel to Bariloche on vacation?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_3', 'Will y going to son dos estructuras de futuro distintas y no se mezclan.')">( C ) Will you going to travel to Bariloche on vacation?</button>
                            <div id="c5_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. Vas a avisar que el equipo va a lanzar el nuevo sitio web el viernes:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c5_4', 'The team actúa como sujeto colectivo singular (It), requiere is.')">( A ) The team is going to launch the new website on Friday.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_4', 'Falta el verbo To Be y launches tiene un exceso de flexión en la s.')">( B ) The team going to launches the new website on Friday.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_4', 'Are go to no sigue la estructura oficial de Be going to.')">( C ) The team are go to launch the new website on Friday.</button>
                            <div id="c5_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Querés decir que ustedes no van a trabajar este fin de semana largo:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_5', 'Don\'t es un auxiliar de presente simple, no de futuro con going to.')">( A ) We don't going to work this long weekend.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c5_5', 'We combina obligatoriamente con are not / aren\'t.')">( B ) We aren't going to work this long weekend.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c5_5', 'Isn\'t se usa solo con He, She o It.')">( C ) We isn't going to work this long weekend.</button>
                            <div id="c5_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Laboratorio Intensivo de Planes y Predicciones con Evidencia</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                    </div>

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

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Redactá un texto sobre tus planes personales o profesionales para los próximos meses de mínimo 6 oraciones...</p>

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
    }

    // ==========================================
    // INSERCIÓN DE CLASE 6 (MÓDULO 2)
    // ==========================================
    const leccion6Existente = await adapter.pgPool.query("SELECT id FROM lecciones WHERE curso_id = 1 AND orden = 6");
    if (leccion6Existente.rows.length === 0) {
        const contenidoClase6 = `
            <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
                <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                    <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">MÓDULO 2 — PRÁCTICA INTERACTIVA</span>
                    <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 6: Presente Continuo y Acciones en Progreso</h2>
                </header>

                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Acciones en el Momento Exacto</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 6.1: Selección de Estructura de Presente Continuo</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee las 5 situaciones e identifica la estructura correcta del Presente Continuo (To Be + Verbo con -ing).</p>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. Querés avisar que en este preciso momento estás estudiando para el examen:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_1', 'Falta el verbo To Be (am) antes del verbo con -ing.')">( A ) I studying for the exam right now.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c6_1', 'Estructura correcta: I + am + verbo con -ing (studying).')">( B ) I am studying for the exam right now.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_1', 'Falta agregar la terminación -ing al verbo study.')">( C ) I am study for the exam right now.</button>
                            <div id="c6_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Contás que los chicos están jugando en el patio en este momento:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c6_2', 'The kids es plural (They), por lo que requiere are + playing.')">( A ) The kids are playing in the yard at the moment.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_2', 'Falta el auxiliar To Be (are) antes de playing.')">( B ) The kids playing in the yard at the moment.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_2', 'The kids es plural, no corresponde usar is.')">( C ) The kids is playing in the yard at the moment.</button>
                            <div id="c6_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. Avisás que tu hermana no está trabajando hoy porque se pidió el día:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_3', 'No se usa el auxiliar doesn\'t con el presente continuo.')">( A ) My sister doesn't working today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c6_3', 'La negación del presente continuo se forma con isn\'t / is not.')">( B ) My sister isn't working today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_3', 'Falta el verbo To Be (is) para formar la negación.')">( C ) My sister not working today.</button>
                            <div id="c6_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. Le preguntás a un compañero si está escuchando la reunión:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_4', 'Do es para presente simple, no para presente continuo.')">( A ) Do you listening to the meeting?</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c6_4', 'Las preguntas en presente continuo usan Are + sujeto + verbo con -ing.')">( B ) Are you listening to the meeting?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_4', 'You se combina con Are, no con Is.')">( C ) Is you listening to the meeting?</button>
                            <div id="c6_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Querés decir que no está lloviendo afuera en este instante:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c6_5', 'Estructura correcta para tiempo atmosférico actual: It + isn\'t + raining.')">( A ) It isn't raining outside right now.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_5', 'Don\'t no se utiliza con el presente continuo.')">( B ) It don't raining outside right now.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c6_5', 'Falta el auxiliar isn\'t para estructurar la negación.')">( C ) It not raining outside right now.</button>
                            <div id="c6_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Detección de Errores y Contraste</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 6.2: Corrección y Traducción en Tiempo Real</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Revisa las correcciones gramaticales y la traducción oficial del ejercicio:</p>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Corrección de Errores:</h5>
                        <ul style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                            <li>"She is read a book right now." &rarr; <strong>She is reading a book right now.</strong> (Faltaba la terminación -ing en el verbo read).</li>
                            <li>"They don't working today." &rarr; <strong>They aren't working today.</strong> (No se usa don't con el presente continuo, corresponde aren't).</li>
                        </ul>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Traducción del Diálogo:</h5>
                        <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin-top: 0.5rem;">
                            <p style="margin: 0;"><strong>Persona A:</strong> "What are you doing now?"</p>
                            <p style="margin: 0;"><strong>Persona B:</strong> "I am cooking dinner and my brother is watching TV."</p>
                        </div>
                    </div>
                </section>

                <section class="bloque-fase" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                        <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                    </div>

                    <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 6</h4>
                            <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Redactá un texto o graba una respuesta de 6 oraciones describiendo qué están haciendo las personas en tu casa u oficina en este instante...</p>

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
        `, [1, 'Clase 6: Presente Continuo y Acciones en Progreso', 'Módulo 2', 6, '', contenidoClase6]);
    }

    // ==========================================
    // INSERCIÓN DE CLASE 7 (MÓDULO 2)
    // ==========================================
    const leccion7Existente = await adapter.pgPool.query("SELECT id FROM lecciones WHERE curso_id = 1 AND orden = 7");
    if (leccion7Existente.rows.length === 0) {
        const contenidoClase7 = `
            <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
                
                <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                    <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">MÓDULO 2 — PRÁCTICA INTERACTIVA</span>
                    <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 7: Verbos Modales de Capacidad y Permiso (Can / Can't)</h2>
                </header>

                <!-- FASE 1 CLASE 7 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Habilidades y Peticiones</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 7.1: Selección de Modales Can y Can't</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Selecciona la respuesta con el uso modal gramaticalmente adecuado:</p>

                        <!-- Pregunta 1 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. Querés decir que sabés hablar inglés pero no sabés hablar alemán:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c7_1', 'Can/Can\'t van seguidos directamente del verbo en infinitivo sin to.')">( A ) I can speak English, but I can't speak German.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_1', 'No debe llevar \'to\' entre can/can\'t y el verbo.')">( B ) I can to speak English, but I can't to speak German.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_1', 'Can es invariable y no agrega \'s\'.')">( C ) I cans speak English, but I can't speak German.</button>
                            <div id="c7_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 2 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Le preguntás a un colega de forma educada si te puede ayudar con un archivo:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_2', 'No se usa el auxiliar Do con el modal Can.')">( A ) Do you can help me with this file?</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c7_2', 'Can encabeza la pregunta directamente sin auxiliares.')">( B ) Can you help me with this file?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_2', 'Falta omitir la partícula \'to\' tras el verbo modal.')">( C ) Can you to help me with this file?</button>
                            <div id="c7_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 3 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. Contás que tu jefe no puede asistir a la reunión de hoy:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c7_3', 'Negación correcta sin to: can\'t attend.')">( A ) My boss can't attend the meeting today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_3', 'Doesn\'t no se usa junto a can.')">( B ) My boss doesn't can attend the meeting today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_3', 'Omitir \'to\' entre can\'t y attend.')">( C ) My boss can't to attend the meeting today.</button>
                            <div id="c7_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 4 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. Querés pedir permiso para pasar a una oficina:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c7_4', 'Estructura directa para permiso: Can I...?')">( A ) Can I come in?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_4', 'Do I can es incorrecto.')">( B ) Do I can come in?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_4', 'Am I can combina auxiliares de forma errónea.')">( C ) Am I can come in?</button>
                            <div id="c7_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 5 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Avisás que ellos no pueden estacionar el auto acá:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c7_5', 'Indica prohibición o imposibilidad directa: can\'t park.')">( A ) They can't park the car here.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_5', 'No combinar don\'t con can.')">( B ) They don't can park the car here.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c7_5', 'Aren\'t no se utiliza antes de can.')">( C ) They aren't can park the car here.</button>
                            <div id="c7_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <!-- FASE 2 CLASE 7 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Detección de Errores y Traducción</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 7.2: Detección y Traducción de Habilidades</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Revisa las soluciones gramaticales de la Fase 2:</p>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Corrección de Errores:</h5>
                        <ul style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                            <li>"She cans drive a car very well." &rarr; <strong>She can drive a car very well.</strong> (Can no agrega "s" en tercera persona).</li>
                            <li>"I can't to swim in the ocean." &rarr; <strong>I can't swim in the ocean.</strong> (Sin "to" después del modal can't).</li>
                        </ul>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Traducción del Diálogo:</h5>
                        <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin-top: 0.5rem;">
                            <p style="margin: 0;"><strong>Persona A:</strong> "Can you use this design software?"</p>
                            <p style="margin: 0;"><strong>Persona B:</strong> "No, I can't use it, but I can learn quickly."</p>
                        </div>
                    </div>
                </section>

                <!-- ENTREGABLE FINAL CLASE 7 -->
                <section class="bloque-fase" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                        <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                    </div>

                    <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 7</h4>
                            <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Escribí una lista estilo perfil profesional de 6 oraciones detallando 3 habilidades que podés hacer en el trabajo (<em>I can...</em>) y 3 que no podés hacer todavía (<em>I can't...</em>):</p>

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
        `, [1, 'Clase 7: Verbos Modales de Capacidad y Permiso (Can / Can\'t)', 'Módulo 2', 7, '', contenidoClase7]);
    }

    // ==========================================
    // INSERCIÓN DE CLASE 8 (MÓDULO 2)
    // ==========================================
    const leccion8Existente = await adapter.pgPool.query("SELECT id FROM lecciones WHERE curso_id = 1 AND orden = 8");
    if (leccion8Existente.rows.length === 0) {
        const contenidoClase8 = `
            <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
                
                <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                    <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">MÓDULO 2 — PRÁCTICA INTERACTIVA</span>
                    <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 8: Sustantivos Contables, Incontables y Cantidades (Much, Many, Some, Any)</h2>
                </header>

                <!-- FASE 1 CLASE 8 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Cuantificadores y Compras</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 8.1: Selección de Cuantificadores</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Selecciona la opción adecuada en función del carácter contable o incontable del sustantivo:</p>

                        <!-- Pregunta 1 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. Querés preguntar cuánto dinero cuesta la entrada:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_1', 'Money es incontable, no lleva many.')">( A ) How many money is the ticket?</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c8_1', 'Money es un sustantivo incontable, requiere How much.')">( B ) How much money is the ticket?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_1', 'Money no admite la forma plural \'moneys\'.')">( C ) How much moneys is the ticket?</button>
                            <div id="c8_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 2 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Vas a comprar manzanas y preguntás cuántas quedan:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c8_2', 'Apples es contable plural y requiere How many.')">( A ) How many apples are there?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_2', 'How much es exclusivo de incontables.')">( B ) How much apples are there?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_2', 'Apple en singular no concuerda con are.')">( C ) How many apple is there?</button>
                            <div id="c8_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 3 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. Querés decir que hay algo de leche en la heladera:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c8_3', 'Milk es incontable (singular) y en afirmativo utiliza some.')">( A ) There is some milk in the fridge.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_3', 'Milk es incontable, no concuerda con There are.')">( B ) There are some milk in the fridge.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_3', 'Any se utiliza en oraciones negativas o preguntas generales.')">( C ) There is any milk in the fridge.</button>
                            <div id="c8_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 4 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. Avisás que no tenés nada de tiempo libre hoy:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_4', 'No se usa some en oraciones negativas estándar.')">( A ) I don't have some free time today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_4', 'I don me have contiene un error gramatical.')">( B ) I don me have any free time today.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c8_4', 'Para expresar ausencia o negar cantidades se usa any.')">( C ) I don't have any free time today.</button>
                            <div id="c8_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 5 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Preguntás si hay algún café disponible:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c8_5', 'Pregunta con sustantivo incontable singular: Is there any...?')">( A ) Is there any coffee available?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_5', 'Coffee es incontable y no combina con Are.')">( B ) Are there any coffee available?</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c8_5', 'En preguntas neutrales la norma es utilizar any.')">( C ) Is there some coffee available?</button>
                            <div id="c8_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <!-- FASE 2 CLASE 8 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Detección de Errores y Traducción</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 8.2: Corrección y Traducción de Cantidades</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Revisa la validación de errores y la traducción oficial del ejercicio:</p>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Corrección de Errores:</h5>
                        <ul style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                            <li>"How many water do you drink per day?" &rarr; <strong>How much water do you drink per day?</strong> (Water es un sustantivo incontable).</li>
                            <li>"There aren't some chairs in the kitchen." &rarr; <strong>There aren't any chairs in the kitchen.</strong> (En oraciones negativas se utiliza any).</li>
                        </ul>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Traducción del Diálogo:</h5>
                        <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin-top: 0.5rem;">
                            <p style="margin: 0;"><strong>Persona A:</strong> "How much coffee do you drink in the morning?"</p>
                            <p style="margin: 0;"><strong>Persona B:</strong> "I drink a lot of coffee, but I don't put any sugar in it."</p>
                        </div>
                    </div>
                </section>

                <!-- ENTREGABLE FINAL CLASE 8 -->
                <section class="bloque-fase" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                        <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                    </div>

                    <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 8</h4>
                            <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Armá tu lista de compras para el supermercado y escribí un texto de 6 oraciones contando qué cosas tenés en tu cocina y qué cosas te faltan comprar (ejemplo: <em>I have some..., I don't have any...</em>):</p>

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
        `, [1, 'Clase 8: Sustantivos Contables, Incontables y Cantidades (Much, Many, Some, Any)', 'Módulo 2', 8, '', contenidoClase8]);
    }

    // ==========================================
    // INSERCIÓN DE CLASE 9 (MÓDULO 2)
    // ==========================================
    const leccion9Existente = await adapter.pgPool.query("SELECT id FROM lecciones WHERE curso_id = 1 AND orden = 9");
    if (leccion9Existente.rows.length === 0) {
        const contenidoClase9 = `
            <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
                
                <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                    <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">MÓDULO 2 — PRÁCTICA INTERACTIVA</span>
                    <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Clase 9: Comparativos y Superlativos (Describiendo y Comparando)</h2>
                </header>

                <!-- FASE 1 CLASE 9 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Estructuras de Comparación</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +20%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 9.1: Selección de Comparativos y Superlativos</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee las 5 situaciones e identifica la estructura comparativa o superlativa correcta:</p>

                        <!-- Pregunta 1 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. Querés decir que Córdoba es más grande que Mendoza:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_1', 'Big es adjetivo corto, no lleva more.')">( A ) Córdoba is more big than Mendoza.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c9_1', 'Adjetivo corto monosílabo duplica la consonante final y agrega -er than.')">( B ) Córdoba is bigger than Mendoza.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_1', 'La conjunción comparativa correcta es than, no that.')">( C ) Córdoba is bigger that Mendoza.</button>
                            <div id="c9_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 2 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Vas a decir que este auto es más caro que aquel:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_2', 'Expensive es adjetivo largo, no admite la terminación -er.')">( A ) This car is expensiver than that one.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c9_2', 'Adjetivos de más de dos sílabas usan la estructura more + adjetivo + than.')">( B ) This car is more expensive than that one.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_2', 'Se debe usar than para comparar, no that.')">( C ) This car is more expensive that that one.</button>
                            <div id="c9_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 3 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. Contás que el examen de hoy fue mejor que el de la semana pasada:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_3', 'Good es irregular, no forma comparativo con more.')">( A ) Today's exam was more good than last week's.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c9_3', 'El comparativo irregular del adjetivo good es better.')">( B ) Today's exam was better than last week's.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_3', 'Gooder es una forma inexistente en inglés.')">( C ) Today's exam was gooder than last week's.</button>
                            <div id="c9_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 4 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. Querés afirmar que este es el lugar más lindo de la ciudad:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c9_4', 'Superlativo de adjetivo largo: the most + adjetivo.')">( A ) This is the most beautiful place in the city.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_4', 'Beautiful es adjetivo largo, no agrega -est.')">( B ) This is the beautifullest place in the city.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_4', 'Falta el artículo the y la forma superlativa most.')">( C ) This is more beautiful place in the city.</button>
                            <div id="c9_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 5 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Decís que este fue el peor día de la semana:</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_5', 'Bad es irregular, no forma superlativo con -est.')">( A ) This was the baddest day of the week.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c9_5', 'El superlativo irregular del adjetivo bad es the worst.')">( B ) This was the worse day of the week.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c9_5', 'Worse es comparativo, para superlativo corresponde worst.')">( C ) This was the worse day of the week.</button>
                            <div id="c9_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <!-- FASE 2 CLASE 9 -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 2: Detección de Errores y Traducción</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +60%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 9.2: Corrección y Traducción de Comparaciones</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568;"><strong>Indicaciones:</strong> Revisa la validación de errores y la traducción oficial del ejercicio:</p>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte I: Corrección de Errores:</h5>
                        <ul style="line-height: 1.8; color: #2d3748; padding-left: 1.2rem; margin-bottom: 1.5rem;">
                            <li>"My house is more small than yours." &rarr; <strong>My house is smaller than yours.</strong> (Small es adjetivo corto y añade -er).</li>
                            <li>"He is the most fast runner in the team." &rarr; <strong>He is the fastest runner in the team.</strong> (Fast es adjetivo corto: superlativo the fastest).</li>
                        </ul>

                        <h5 style="color: #184168; margin-bottom: 0.5rem;">Parte II: Traducción del Diálogo:</h5>
                        <div style="background: #f7fafc; border-left: 3px solid #184168; padding: 1rem; border-radius: 4px; line-height: 1.8; color: #2d3748; margin-top: 0.5rem;">
                            <p style="margin: 0;"><strong>Persona A:</strong> "Is your new job more difficult than the previous one?"</p>
                            <p style="margin: 0;"><strong>Persona B:</strong> "Yes, it is more difficult, but it is the best job I had."</p>
                        </div>
                    </div>
                </section>

                <!-- ENTREGABLE FINAL CLASE 9 -->
                <section class="bloque-fase" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                        <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">ENTREGABLE FINAL (Práctica Manual con Corrección del Profesor)</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +20%</span>
                    </div>

                    <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Trabajo Práctico Integrador — Clase 9</h4>
                            <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;"><strong>Consigna:</strong> Elegí dos celulares, dos ciudades o dos trabajos y escribí un texto comparativo de 6 oraciones usando al menos 3 comparativos y 2 superlativos (ejemplo: <em>is cheaper than, is the most popular...</em>):</p>

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
        `, [1, 'Clase 9: Comparativos y Superlativos (Describiendo y Comparando)', 'Módulo 2', 9, '', contenidoClase9]);
    }

    // ==========================================
    // INSERCIÓN DE CLASE 10 (MÓDULO 2 - EXAMEN FINAL)
    // ==========================================
    const leccion10Existente = await adapter.pgPool.query("SELECT id FROM lecciones WHERE curso_id = 1 AND orden = 10");
    if (leccion10Existente.rows.length === 0) {
        const contenidoClase10 = `
            <div class="clase-contenido" style="color: #1a202c; font-family: system-ui, -apple-system, sans-serif;">
                
                <header style="margin-bottom: 2rem; border-bottom: 2px solid #0b2238; padding-bottom: 1rem;">
                    <span style="background: #0b2238; color: white; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">INGLÉS SUEZ — CURSO: INGLÉS INTENSIVO DESDE CERO</span>
                    <h2 style="color: #0b2238; margin-top: 0.8rem; margin-bottom: 0;">Módulo 2 / Clase 10: Evaluación Final Integradora (Reading & Written Production)</h2>
                </header>

                <!-- FASE 1 CLASE 10: READING COMPREHENSION -->
                <section class="bloque-fase" style="margin-bottom: 3rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #e2ebd5; padding: 0.8rem 1.2rem; border-radius: 6px; margin-bottom: 1.5rem; border-left: 4px solid #184168;">
                        <h3 style="margin: 0; color: #0b2238; font-size: 1.1rem; text-transform: uppercase;">FASE 1: Lectura Comprensiva y Análisis de Texto (Reading Comprehension)</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #184168;">Impacto en Progreso: +30%</span>
                    </div>

                    <div class="ejercicio-card" style="background: white; border: 1px solid #c0d4e5; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Ejercicio 10.1: Comprensión Lectora e Identificación de Tiempos Verbales</h4>
                            <span style="background: #edf2f7; color: #4a5568; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: En Progreso</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #4a5568; margin-bottom: 1.2rem;"><strong>Indicaciones:</strong> Lee atentamente el siguiente caso de estudio sobre la historia de Mateo y responde las 5 preguntas de comprensión seleccionando la opción correcta.</p>

                        <!-- TEXTO DE CASO DE ESTUDIO -->
                        <div style="background: #f7fafc; border-left: 4px solid #184168; padding: 1.2rem; border-radius: 4px; font-size: 0.95rem; color: #2d3748; line-height: 1.7; margin-bottom: 2rem;">
                            <h5 style="margin-top: 0; color: #0b2238; font-size: 1.05rem;">Mateo’s Career Shift</h5>
                            <p style="margin-bottom: 0.8rem;">"Two years ago, Mateo was a junior accountant in a small office in Rosario. He lived with his parents, didn't have a car, and worked 10 hours every day. He wasn't very happy because he couldn't speak English, so he couldn't apply for better international jobs.</p>
                            <p style="margin-bottom: 0.8rem;">Last year, he decided to change his life. He started an intensive course at Inglés Suez, studied every night, and bought a laptop to practice. Today, Mateo is working as a project manager for a tech company in Buenos Aires. He lives in a big apartment near the center. There are many cafes in his neighborhood, and he usually walks to work.</p>
                            <p style="margin-bottom: 0;">Right now, Mateo is sitting in a coffee shop, writing a report, and drinking an espresso. Next month, he is going to travel to London for a business conference. He believes his English is much better than two years ago, and he is going to apply for a promotion soon."</p>
                        </div>

                        <!-- Pregunta 1 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>1. What was Mateo's situation two years ago?</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_1', 'En ese momento no vivía en Buenos Aires ni era manager.')">( A ) He was a project manager in Buenos Aires.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c10_1', 'Pasado Simple: describe la situación inicial de Mateo.')">( B ) He was an accountant, lived with his parents, and couldn't speak English.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_1', 'No tenía auto ni vivía en Londres.')">( C ) He lived in London and had a car.</button>
                            <div id="c10_1" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 2 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>2. Why couldn't Mateo apply for international jobs in the past?</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_2', 'Compró una laptop después, pero la causa directa era no hablar inglés.')">( A ) Because he didn't have a laptop.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_2', 'Vivía en Rosario en ese período, no en Buenos Aires.')">( B ) Because he worked in Buenos Aires.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c10_2', 'Uso de Can/Couldn\'t: expresa la imposibilidad de habilidad en el pasado.')">( C ) Because he couldn't speak English.</button>
                            <div id="c10_2" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 3 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>3. What is Mateo doing right now?</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_3', 'Viajar a Londres es su plan para el mes que viene.')">( A ) He is traveling to London.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c10_3', 'Presente Continuo: expresa las acciones en desarrollo en el momento exacto.')">( B ) He is sitting in a coffee shop, writing a report, and drinking coffee.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_3', 'Empezó el curso el año pasado, ahora ya trabaja como manager.')">( C ) He is studying for an exam at Inglés Suez.</button>
                            <div id="c10_3" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 4 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #edf2f7;">
                            <p><strong>4. What is his plan for next month?</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c10_4', 'Be going to: expresa un plan futuro ya definido para el mes que viene.')">( A ) He is going to travel to London for a business conference.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_4', 'No se menciona la compra de un automóvil en sus planes.')">( B ) He is going to buy a new car.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_4', 'Se mudó a Buenos Aires el año pasado, no planea volver.')">( C ) He is going to move to Rosario.</button>
                            <div id="c10_4" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>

                        <!-- Pregunta 5 -->
                        <div class="quiz-question" style="margin-bottom: 1.5rem;">
                            <p><strong>5. Which comparison does Mateo make about his English?</strong></p>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_5', 'El texto afirma exactamente lo contrario.')">( A ) His English is worse than two years ago.</button>
                            <button class="option-btn" onclick="checkAnswer(this, false, 'c10_5', 'Afirma haber mejorado considerablemente.')">( B ) His English is as bad as last year.</button>
                            <button class="option-btn" onclick="checkAnswer(this, true, 'c10_5', 'Comparativos: uso del adjetivo irregular better than.')">( C ) His English is much better than two years ago.</button>
                            <div id="c10_5" style="display:none; padding: 0.8rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem;"></div>
                        </div>
                    </div>
                </section>

                <!-- ENTREGABLE FINAL CLASE 10: PROYECTO INTEGRADOR DE CIERRE DE NIVEL -->
                <section class="bloque-fase" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #0b2238; color: white; padding: 0.8rem 1.2rem; border-radius: 6px 6px 0 0;">
                        <h3 style="margin: 0; font-size: 1.1rem; text-transform: uppercase;">PROYECTO INTEGRADOR FINAL DE CIERRE DE NIVEL — My Life Journey</h3>
                        <span style="font-size: 0.85rem; font-weight: bold; color: #a4c4de;">Restante para 100%: +70%</span>
                    </div>

                    <div style="background: white; border: 1px solid #0b2238; border-top: none; border-radius: 0 0 8px 8px; padding: 1.8rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #edf2f7; padding-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #0b2238; font-size: 1.05rem;">Consigna de Producción Escrita Integradora</h4>
                            <span style="background: #fffaf0; color: #c05621; border: 1px solid #fbd38d; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Estado: Pendiente de Envío</span>
                        </div>

                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;">
                            Tomando como inspiración el texto de Mateo, redactá tu propia biografía laboral/personal integradora en un ensayo estructurado de mínimo 3 párrafos (entre 120 y 180 palabras en total).
                        </p>
                        
                        <p style="font-size: 0.95rem; color: #2d3748; line-height: 1.6;">
                            Tu escrito debe estar dividido exactamente en estas tres secciones e incluir todos los elementos gramaticales trabajados durante el curso:
                        </p>

                        <div style="background: #f7fafc; padding: 1.2rem; border-radius: 6px; border: 1px solid #e2e8f0; margin: 1rem 0;">
                            <h5 style="margin-top: 0; color: #184168; font-size: 0.95rem;">📄 PÁRRAFO 1: Mi Pasado (My Past)</h5>
                            <p style="font-size: 0.9rem; color: #4a5568; margin-bottom: 0.5rem;"><strong>Objetivo:</strong> Describir cómo era tu vida hace 1 o 2 años.</p>
                            <ul style="font-size: 0.88rem; color: #2d3748; line-height: 1.6; margin-bottom: 1rem;">
                                <li>Uso del verbo To Be en pasado (<em>was / were</em>).</li>
                                <li>Al menos 2 verbos en Pasado Simple (un regular como <em>studied, worked, lived</em> y un irregular como <em>went, bought, had</em>).</li>
                                <li>Una oración en negativo con <em>didn't</em>.</li>
                                <li>Una habilidad o imposibilidad del pasado usando <em>could</em> o <em>couldn't</em>.</li>
                            </ul>

                            <h5 style="margin-top: 1rem; color: #184168; font-size: 0.95rem;">📄 PÁRRAFO 2: Mi Presente y Entorno (My Present)</h5>
                            <p style="font-size: 0.9rem; color: #4a5568; margin-bottom: 0.5rem;"><strong>Objetivo:</strong> Describir tu rutina actual, tu espacio y lo que estás haciendo hoy.</p>
                            <ul style="font-size: 0.88rem; color: #2d3748; line-height: 1.6; margin-bottom: 1rem;">
                                <li>Una oración de rutina en Presente Simple (<em>I work, I study, I live</em>).</li>
                                <li>Descripción de existencia de tu entorno usando <em>There is</em> o <em>There are</em>.</li>
                                <li>Una cantidad usando <em>some, any, much</em> o <em>many</em>.</li>
                                <li>Una oración en Presente Continuo describiendo qué estás haciendo en este período de tu vida (<em>Right now, I am studying English at Inglés Suez...</em>).</li>
                            </ul>

                            <h5 style="margin-top: 1rem; color: #184168; font-size: 0.95rem;">📄 PÁRRAFO 3: Mis Comparaciones y Planes Futuros (My Future & Goals)</h5>
                            <p style="font-size: 0.9rem; color: #4a5568; margin-bottom: 0.5rem;"><strong>Objetivo:</strong> Comparar tu situación actual con el pasado y detallar tus próximos proyectos.</p>
                            <ul style="font-size: 0.88rem; color: #2d3748; line-height: 1.6; margin-bottom: 0;">
                                <li>Una comparación entre tu presente y tu pasado usando un adjetivo comparativo (<em>better than, easier than, more interesting than</em>).</li>
                                <li>Al menos 2 oraciones con planes futuros usando la estructura <em>be going to</em> (<em>I am going to travel, I am going to apply...</em>).</li>
                                <li>Una oración de habilidad actual usando <em>can</em> o <em>can't</em>.</li>
                            </ul>
                        </div>

                        <div style="margin-top: 1.5rem;">
                            <textarea placeholder="Escribe aquí tu Proyecto Integrador Final de 3 párrafos para la corrección detallada del profesor..." style="width: 100%; height: 180px; padding: 0.8rem; border: 1px solid #cbd5e0; border-radius: 6px; font-family: inherit; font-size: 0.95rem; margin-bottom: 1rem; resize: vertical;"></textarea>
                            
                            <div style="display: flex; gap: 1rem; justify-content: flex-end; flex-wrap: wrap;">
                                <button type="button" style="background: #edf2f7; color: #2d3748; border: 1px solid #cbd5e0; padding: 0.7rem 1.2rem; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9rem;">
                                    [ CAJA DE TEXTO EXTENSA / SUBIR DOCUMENTO ]
                                </button>
                                <button type="button" style="background: #184168; color: white; border: none; padding: 0.7rem 1.4rem; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
                                    ENVIAR PROYECTO FINAL A REVISIÓN MANUAL
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
        `, [1, 'Clase 10: Evaluación Final Integradora (Reading & Written Production)', 'Módulo 2', 10, '', contenidoClase10]);
    }

    return adapter;
})();

export default dbPromise;