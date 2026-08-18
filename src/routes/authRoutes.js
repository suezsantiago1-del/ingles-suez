import express from 'express';
import { 
    renderLogin, 
    processLogin, 
    renderRegister, 
    processRegister, 
    logout,
    renderProfile,
    updateProfile,
    updatePassword,
    renderVerifyEmail,
    verifyEmail,
    resendVerification
} from '../controllers/authController.js';

import {
    renderPrivateClasses,
    guardarConsultaParticulares,
    enviarMensajeAlumnoChat,
    renderPanelParticularesProfesor,
    guardarRespuestaParticular
} from '../controllers/courseController.js';

const router = express.Router();

// Autenticación
router.get('/login', renderLogin);
router.post('/login', processLogin);

router.get('/register', renderRegister);
router.post('/register', processRegister);

router.get('/logout', logout);

// Verificación de email
router.get('/verify/:token', verifyEmail);
router.get('/verify-email', renderVerifyEmail);
router.post('/resend-verification', resendVerification);

// Rutas de Perfil
router.get('/profile', renderProfile);
router.post('/profile/update', updateProfile);
router.post('/profile/password', updatePassword);

// ==========================================
// RUTAS DE CLASES PARTICULARES (CHAT)
// ==========================================

// Vistas y envíos de alumnos
router.get('/clases-particulares', renderPrivateClasses);
router.post('/clases-particulares/enviar', guardarConsultaParticulares);
router.post('/clases-particulares/enviar-mensaje', enviarMensajeAlumnoChat);

// Panel y respuestas del profesor
router.get('/profesor/particulares', renderPanelParticularesProfesor);
router.post('/profesor/particulares/responder', guardarRespuestaParticular);

export default router;