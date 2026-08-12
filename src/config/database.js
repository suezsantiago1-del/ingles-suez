import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Objeto DB adaptable
class DatabaseAdapter {
    constructor() {
        this.isPg = !!process.env.DATABASE_URL;
        if (this.isPg) {
            this.pgPool = new pg.Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });
        }
    }

    async initSQLite() {
        if (!this.sqliteDb) {
            this.sqliteDb = await open({
                filename: path.join(__dirname, '../../database.sqlite'),
                driver: sqlite3.Database
            });
        }
        return this.sqliteDb;
    }

    async run(sql, params = []) {
        if (this.isPg) {
            // Convertir sintaxis SQLite a PostgreSQL ($1, $2...)
            let paramIndex = 1;
            const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
            const res = await this.pgPool.query(pgSql, params);
            return { lastID: res.rows[0] ? res.rows[0].id : null, changes: res.rowCount };
        } else {
            const db = await this.initSQLite();
            return await db.run(sql, params);
        }
    }

    async all(sql, params = []) {
        if (this.isPg) {
            let paramIndex = 1;
            const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
            const res = await this.pgPool.query(pgSql, params);
            return res.rows;
        } else {
            const db = await dbPromise;
            return await db.all(sql, params);
        }
    }

    async get(sql, params = []) {
        if (this.isPg) {
            let paramIndex = 1;
            const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
            const res = await this.pgPool.query(pgSql, params);
            return res.rows[0];
        } else {
            const db = await this.initSQLite();
            return await db.get(sql, params);
        }
    }
}

const dbPromise = (async () => {
    const adapter = new DatabaseAdapter();
    if (!adapter.isPg) {
        const db = await adapter.initSQLite();
        await db.exec(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cursos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                descripcion TEXT NOT NULL,
                precio INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS compras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL,
                curso_id INTEGER NOT NULL,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Insertar cursos iniciales si no existen
        const count = await db.get("SELECT COUNT(*) as count FROM cursos");
        if (count.count === 0) {
            await db.run("INSERT INTO cursos (titulo, descripcion, precio) VALUES (?, ?, ?)", [
                'Inglés Intensivo Desde Cero',
                'Aprende las bases fundamentales del idioma de forma totalmente práctica y natural.',
                5000
            ]);
            await db.run("INSERT INTO cursos (titulo, descripcion, precio) VALUES (?, ?, ?)", [
                'Conversación y Fluidez Real',
                'Enfocado en hablar sin presiones, mejorar pronunciación y ganar confianza en el día a día.',
                5000
            ]);
        }
    }
    return adapter;
})();

export default dbPromise;