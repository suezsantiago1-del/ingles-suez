import express from 'express';
import { 
    renderLogin, 
    processLogin, 
    renderRegister, 
    processRegister, 
    logout,
    renderProfile,
    updateProfile,
    updatePassword
} from '../controllers/authController.js';

import {
    renderPanelParticularesProfesor,
    responderConsultaParticular,
    enviarMensajeAlumnoChat
} from '../controllers/teacherController.js';

const router = express.Router();

// Autenticación
router.get('/login', renderLogin);
router.post('/login', processLogin);

router.get('/register', renderRegister);
router.post('/register', processRegister);

router.get('/logout', logout);

// Rutas de Perfil
router.get('/profile', renderProfile);
router.post('/profile/update', updateProfile);
router.post('/profile/password', updatePassword);

// ==========================================
// RUTAS CHAT CLASES PARTICULARES
// ==========================================
router.get('/profesor/particulares', renderPanelParticularesProfesor);
router.post('/profesor/particulares/responder', responderConsultaParticular);
router.post('/clases-particulares/enviar-mensaje', enviarMensajeAlumnoChat);

export default router;