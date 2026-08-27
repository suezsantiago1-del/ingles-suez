import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dbPromise from './src/config/database.js';
import authRoutes from './src/routes/authRoutes.js';
import { 
    renderCourseDetail, 
    processCheckout, 
    validarCodigoDescuento,
    obtenerDesafioDiario,
    paymentSuccess, 
    paymentFailure, 
    renderMyCourses,
    renderClassroom,
    guardarEntrega,
    renderPanelProfesor,
    renderGestionCursos,
    renderConsultasProfesor,
    guardarDevolucion,
    saveTeacherNote,
    updateLessonTeacherNote,
    eliminarNotaLeccion,
    actualizarContenidoLeccion,
    uploadLessonVideo,
    handleMpWebhook,
    renderMensajesAlumno,
    guardarConsultaLeccion,
    responderConsultaLeccion,
    renderMessagesList,
    renderMessagesCourse,
    marcarMensajesLeidos,
    descargarCertificado,
    renderPrivateClasses,
    guardarConsultaParticulares,
    enviarMensajeAlumnoChat,
    renderPanelParticularesProfesor,
    guardarRespuestaParticular,
    completarDesafio,
    renderProfesorRachas,
    enviarRecompensaUsuario
} from './src/controllers/courseController.js';
import { createOrUpdateAnnouncement, deleteAnnouncement } from './src/controllers/courseController.js';
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

// Configure uploads directory (allow overriding with env var for persistent mounts)
const configuredUploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'public', 'videos');
const videosDir = configuredUploadsDir;
try {
    if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
} catch (e) {
    console.error('Could not ensure videos directory exists:', e);
}

// If uploads directory is outside public, expose it at /uploads so files are reachable
const publicDir = path.join(__dirname, 'public');
if (!videosDir.startsWith(publicDir)) {
    app.use('/uploads', express.static(videosDir));
} else {
    // If uploads are inside public, expose them explicitly at their relative path
    const rel = path.relative(publicDir, videosDir).replace(/\\/g, '/');
    const mountPoint = '/' + rel;
    app.use(mountPoint, express.static(videosDir));
    // Also expose at /videos for backward compatibility when folder is videos
    if (rel.endsWith('videos')) {
        app.use('/videos', express.static(videosDir));
    }
}

// Middleware to log request headers for upload routes (diagnostic)
function uploadDebugLogger(req, res, next) {
    try {
        console.log('uploadDebugLogger: incoming', req.method, req.originalUrl, 'at', new Date().toISOString());
        console.log('uploadDebugLogger: headers:', {
            'content-length': req.headers['content-length'],
            'content-type': req.headers['content-type'],
            host: req.headers.host
        });
    } catch (e) {
        console.warn('uploadDebugLogger: error logging headers', e);
    }
    next();
}

// Increase payload limits for non-multipart parsers (safe default for this app)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

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

// Test de nivel de inglés (público, sin login)
app.get('/test-nivel', (req, res) => {
    res.render('test-nivel');
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
app.post('/validar-codigo-descuento', express.json(), validarCodigoDescuento);
app.get('/desafio-diario', obtenerDesafioDiario);
app.post('/desafio-diario/completar', completarDesafio);
app.get('/profesor/rachas', renderProfesorRachas);
app.post('/profesor/rachas/recompensar', enviarRecompensaUsuario);
app.get('/payment/success', paymentSuccess);
app.get('/payment/failure', paymentFailure);
app.get('/mis-cursos', renderMyCourses);
app.get('/classroom/:cursoId', renderClassroom);
app.get('/classroom/:cursoId/certificado', descargarCertificado);

// Mercado Pago webhook endpoint for async payment notifications
app.post('/mercadopago/webhook', express.json(), handleMpWebhook);

// Entregas de alumnos y panel del profesor para cursos
app.post('/entregas', guardarEntrega);
app.get('/profesor/entregas', renderPanelProfesor);
app.get('/profesor/gestion', renderGestionCursos);
app.get('/profesor/consultas', renderConsultasProfesor);
app.post('/profesor/devolucion', guardarDevolucion);
app.post('/profesor/nota', express.json(), saveTeacherNote);
app.post('/profesor/anuncio', express.json(), createOrUpdateAnnouncement);
app.delete('/profesor/anuncio', express.json(), deleteAnnouncement);
app.post('/profesor/leccion/nota', express.json(), updateLessonTeacherNote);
app.post('/profesor/leccion/nota/eliminar', express.json(), eliminarNotaLeccion);
app.post('/profesor/leccion/contenido', express.json(), actualizarContenidoLeccion);

// Consultas de alumnos al profesor por lección
app.post('/consultas/leccion', express.json(), guardarConsultaLeccion);
app.post('/profesor/consulta/responder', express.json(), responderConsultaLeccion);

// Multer setup for lesson video uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, videosDir);
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-z0-9\.-\_]/gi, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});

// Increase Multer upload limit to 2GB to support large lesson videos
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // up to ~2GB

// Middleware to detect aborted uploads and log request info
function uploadRequestLogger(req, res, next) {
    req.on('aborted', () => {
        console.warn('Upload request aborted by the client. url=', req.originalUrl, 'content-length=', req.headers['content-length']);
    });
    req.on('error', (err) => {
        console.error('Request stream error during upload:', err && err.stack ? err.stack : err);
    });
    next();
}

// Endpoint for professor to upload a lesson video or set a video URL
app.post('/profesor/leccion/video', uploadRequestLogger, uploadDebugLogger, upload.single('videoFile'), uploadLessonVideo);

// Legacy route: redirect old 'Mis Mensajes' to new messages master list
app.get('/mis-mensajes', (req, res) => {
    return res.redirect('/messages');
});

// Messages master list and detail per course
app.get('/messages', renderMessagesList);
app.get('/messages/:courseId', renderMessagesCourse);
app.post('/messages/leer', marcarMensajesLeidos);

// Global error handler (catches Multer and body-parser errors and returns JSON)
app.use((err, req, res, next) => {
    console.error('Global error handler:', err && err.stack ? err.stack : err);

    // Multer errors
    if (err && (err instanceof multer.MulterError || err.name === 'MulterError')) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'El archivo excede el tamaño máximo permitido' });
        }
        return res.status(400).json({ success: false, message: err.message || 'Error en la subida de archivo' });
    }

    // body-parser / express errors for entity too large
    if (err && (err.type === 'entity.too.large' || err.message && err.message.includes('request entity too large'))) {
        return res.status(413).json({ success: false, message: 'Payload demasiado grande' });
    }

    if (res.headersSent) return next(err);

    // If the client accepts HTML, send a simple 500 HTML page to avoid rendering templates here
    try {
        if (req && req.accepts && req.accepts('html')) {
            return res.status(500).send('<h1>500 - Error interno del servidor</h1>');
        }
    } catch (renderErr) {
        console.error('Error in global error renderer:', renderErr && renderErr.stack ? renderErr.stack : renderErr);
    }

    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

// Manejo de error 404 (colocado después del handler de errores)
app.use((req, res) => {
    res.status(404).send('<h1>404 - Página no encontrada</h1>');
});

const server = app.listen(PORT, async () => {
    try {
        await dbPromise;
        console.log("Base de datos conectada correctamente");
    } catch (e) {
        console.error("Error al conectar la base de datos:", e);
    }
    // Log uploads serving info
    try {
        const publicDir = path.join(__dirname, 'public');
        let serveRoot = '/videos';
        if (videosDir.startsWith(publicDir)) {
            serveRoot = '/' + path.relative(publicDir, videosDir).replace(/\\/g, '/');
        } else {
            serveRoot = '/uploads';
        }
        console.log(`Uploads directory: ${videosDir} (served at ${serveRoot})`);
    } catch (e) {
        console.warn('Could not compute uploads serving info:', e);
    }

    console.log(`Servidor listo en: http://localhost:${PORT}`);
});

// Disable default Node timeout so large uploads aren't cut off mid-transfer
try {
    server.timeout = 0; // 0 = no timeout
} catch (e) {
    console.warn('Could not set server timeout:', e);
}