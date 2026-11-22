// Script de importación único (manual) del banco de desafíos.
// Uso: node --env-file=.env importar-desafios.mjs
// Lee seeds/banco-desafios.json (respaldo no público) y lo inserta en desafios_diarios.
import pg from 'pg';
import { readFileSync } from 'fs';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const RUTA = 'seeds/banco-desafios.json';
const TIPOS_VALIDOS = ['quiz', 'situacion', 'error', 'real', 'conversacion', 'dificil', 'listening', 'listening_corto'];

async function main() {
    const items = JSON.parse(readFileSync(RUTA, 'utf8'));
    console.log('Leídos', items.length, 'desafíos del JSON.');

    // Validaciones de integridad
    let invalidos = 0;
    for (const d of items) {
        const okTipo = TIPOS_VALIDOS.includes(d.tipo);
        const okResp = /^[ABC]$/i.test(d.respuesta_correcta || '');
        if (!okTipo || !okResp) { invalidos++; console.error('Item inválido:', d.tipo, d.respuesta_correcta, d.pregunta); }
    }
    if (invalidos) { console.error('Hay', invalidos, 'items inválidos. Abortando.'); await pool.end(); process.exit(1); }

    // Duplicados: comparar contra preguntas ya existentes
    const existentes = await pool.query('SELECT pregunta FROM desafios_diarios');
    const yaExisten = new Set(existentes.rows.map(r => r.pregunta));

    let insertados = 0, duplicados = 0, errores = 0;

    const insertSQL = `INSERT INTO desafios_diarios
        (pregunta, opcion_a, opcion_b, opcion_c, respuesta_correcta, explicacion, ejemplo, categoria, tipo, texto_audio, orden)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

    for (let i = 0; i < items.length; i++) {
        const d = items[i];
        if (yaExisten.has(d.pregunta)) { duplicados++; continue; }
        const orden = i + 1;
        try {
            await pool.query(insertSQL, [
                d.pregunta, d.opcion_a, d.opcion_b, d.opcion_c,
                String(d.respuesta_correcta).toUpperCase(),
                d.explicacion, d.ejemplo, d.categoria, d.tipo,
                d.texto_audio || null,
                orden
            ]);
            insertados++;
        } catch (e) {
            errores++;
            console.error('Error al insertar item', i + 1, ':', e.message);
        }
    }

    console.log('--- Resultado ---');
    console.log('Total leído:', items.length);
    console.log('Insertados:', insertados);
    console.log('Duplicados (ya existían):', duplicados);
    console.log('Errores:', errores);
    await pool.end();
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });