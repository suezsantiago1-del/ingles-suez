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

const router = express.Router();

router.get('/login', renderLogin);
router.post('/login', processLogin);

router.get('/register', renderRegister);
router.post('/register', processRegister);

router.get('/logout', logout);

// Rutas de Perfil
router.get('/profile', renderProfile);
router.post('/profile/update', updateProfile);
router.post('/profile/password', updatePassword);

export default router;