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
    resendVerification,
    renderForgotPassword,
    processForgotPassword,
    renderResetPassword,
    processResetPassword
} from '../controllers/authController.js';

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

// Recuperación de contraseña
router.get('/forgot-password', renderForgotPassword);
router.post('/forgot-password', processForgotPassword);
router.get('/reset-password/:token', renderResetPassword);
router.post('/reset-password/:token', processResetPassword);

// Rutas de Perfil
router.get('/profile', renderProfile);
router.post('/profile/update', updateProfile);
router.post('/profile/password', updatePassword);

// Las rutas de clases particulares viven en server.js (nivel raíz).

export default router;