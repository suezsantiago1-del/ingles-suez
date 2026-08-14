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
    guardarEntrega,
    renderPanelProfesor,
    guardarDevolucion,
    uploadLessonVideo,
    renderMensajesAlumno,
    descargarCertificado,
    renderPrivateClasses,
    guardarConsultaParticulares,
    enviarMensajeAlumnoChat,
    renderPanelParticularesProfesor,
    guardarRespuestaParticular
} from './src/controllers/courseController.js';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// OBLIGATORIO para plataformas en la nube (Render, Railway, Heroku, Vercel)
// Permite que Express confíe en las cookies enviadas a través del Proxy HTTPS
app.set('trust proxy', 1);

// Middleware para forzar HTTPS en producción
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

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
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24, // 1 día
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// Middleware de variables locales globales
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.comprasIds = [];
    res.locals.mensajesNoLeidos = 0;

    if (req.session.user) {
        try {
            const db = await dbPromise;
            const compras = await db.all(
                'SELECT curso_id FROM compras WHERE usuario_id = ?', 
                [req.session.user.id]
            );
            res.locals.comprasIds = compras.map(c => c.curso_id);

            // Contar devoluciones no leídas para la badge de notificación
            const noLeidos = await db.get(
                'SELECT COUNT(*) as count FROM devoluciones WHERE usuario_id = ? AND leida = FALSE',
                [req.session.user.id]
            );
            res.locals.mensajesNoLeidos = noLeidos ? parseInt(noLeidos.count) : 0;
        } catch (error) {
            console.error('Error al cargar datos en middleware:', error);
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

// Rutas de Clases Particulares (vista y envíos del alumno)
app.get('/clases-particulares', renderPrivateClasses);
app.post('/clases-particulares/enviar', guardarConsultaParticulares);
app.post('/clases-particulares/enviar-mensaje', enviarMensajeAlumnoChat);

// Rutas del panel del profesor para Clases Particulares
app.get('/profesor/particulares', renderPanelParticularesProfesor);
app.post('/profesor/particulares/responder', guardarRespuestaParticular);

// Ruta de Todos los Cursos
app.get('/cursos-todos', async (req, res) => {
    try {
        const db = await dbPromise;
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
        const cursos = await db.all('SELECT * FROM cursos');
        res.render('index', { cursos });
    } catch (error) {
        console.error('Error al obtener cursos:', error);
        res.render('index', { cursos: [] });
    }
});

// Cursos, pagos y aula virtual
app.get('/course/:id', renderCourseDetail);
app.post('/checkout/:id', processCheckout);
app.get('/payment/success', paymentSuccess);
app.get('/payment/failure', paymentFailure);
app.get('/mis-cursos', renderMyCourses);
app.get('/classroom/:cursoId', renderClassroom);
app.get('/classroom/:cursoId/certificado', descargarCertificado);

// Entregas de alumnos y panel del profesor para cursos
app.post('/entregas', guardarEntrega);
app.get('/profesor/entregas', renderPanelProfesor);
app.post('/profesor/devolucion', guardarDevolucion);

// Multer setup for lesson video uploads (stored in public/videos)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public', 'videos'));
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-z0-9\.\-\_]/gi, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});

const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // up to ~1GB

// Endpoint for professor to upload a lesson video or set a video URL
app.post('/profesor/leccion/video', upload.single('videoFile'), uploadLessonVideo);

// Bandeja de entrada de devoluciones para los alumnos (exclusivo cursos)
app.get('/mis-mensajes', renderMensajesAlumno);

// Manejo de error 404
app.use((req, res) => {
    res.status(404).send('<h1>404 - Página no encontrada</h1>');
});

app.listen(PORT, async () => {
    try {
        await dbPromise;
        console.log("Base de datos conectada correctamente");
    } catch (e) {
        console.error("Error al conectar la base de datos:", e);
    }
    console.log(`Servidor listo en: http://localhost:${PORT}`);
});