import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import dbPromise from './src/config/database.js';
import authRoutes from './src/routes/authRoutes.js';
import { 
    renderCourseDetail, 
    processCheckout, 
    paymentSuccess, 
    paymentFailure, 
    renderMyCourses,
    renderClassroom,
    guardarEntrega
} from './src/controllers/courseController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/views'));

// Servir archivos estáticos desde public
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'clave_secreta_suez',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Middleware de variables locales globales
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.comprasIds = [];

    if (req.session.user) {
        try {
            const db = await dbPromise;
            const compras = await db.all(
                'SELECT curso_id FROM compras WHERE usuario_id = ?', 
                [req.session.user.id]
            );
            res.locals.comprasIds = compras.map(c => c.curso_id);
        } catch (error) {
            console.error('Error al cargar cursos comprados en middleware:', error);
        }
    }
    next();
});

// Autenticación
app.use('/auth', authRoutes);
app.get('/perfil', (req, res) => res.redirect('/auth/profile'));

// Ruta de Acerca de
app.get('/about', (req, res) => {
    res.render('about');
});

// Ruta de Clases Particulares
app.get('/clases-particulares', (req, res) => {
    res.render('privateClasses');
});

// Ruta de Todos los Cursos
app.get('/cursos-todos', async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE cursos SET precio = 5000");
        await db.run("DELETE FROM cursos WHERE titulo LIKE '%Negocios%' OR titulo LIKE '%Business%'");
        const cursos = await db.all('SELECT * FROM cursos');
        res.render('courses', { cursos });
    } catch (error) {
        console.error('Error al obtener cursos:', error);
        res.render('courses', { cursos: [] });
    }
});

// Ruta principal
app.get('/', async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE cursos SET precio = 5000");
        await db.run("DELETE FROM cursos WHERE titulo LIKE '%Negocios%' OR titulo LIKE '%Business%'");
        const cursos = await db.all('SELECT * FROM cursos');
        res.render('index', { cursos });
    } catch (error) {
        console.error('Error al obtener cursos:', error);
        res.render('index', { cursos: [] });
    }
});

// Cursos y pagos
app.get('/course/:id', renderCourseDetail);
app.post('/checkout/:id', processCheckout);
app.get('/payment/success', paymentSuccess);
app.get('/payment/failure', paymentFailure);
app.get('/mis-cursos', renderMyCourses);
app.get('/classroom/:cursoId', renderClassroom);

// Ruta para guardar entregas de tareas del alumno
app.post('/entregas', guardarEntrega);

// Manejo de error 404
app.use((req, res) => {
    res.status(404).send('<h1>404 - Página no encontrada</h1>');
});

app.listen(PORT, async () => {
    try {
        const db = await dbPromise;
        await db.run("UPDATE cursos SET precio = 5000");
        await db.run("DELETE FROM cursos WHERE titulo LIKE '%Negocios%' OR titulo LIKE '%Business%'");
        console.log("Datos actualizados correctamente");
    } catch (e) {
        console.error("Error al actualizar la base de datos:", e);
    }
    console.log(`Servidor listo en: http://localhost:${PORT}`);
});