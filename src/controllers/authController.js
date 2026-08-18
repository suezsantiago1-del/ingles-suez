import bcrypt from 'bcrypt';
import dbPromise from '../config/database.js';
import crypto from 'crypto';
import { sendVerificationEmail } from '../services/emailService.js';

export const renderLogin = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    return res.render('login', { error: null });
};

export const processLogin = async (req, res) => {
    const { email, password, remember } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    try {
        const db = await dbPromise;

        // Buscamos al usuario de forma segura
        const usuario = await db.get('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)', [cleanEmail]);

        if (!usuario) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos.' });
        }

        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos.' });
        }

        // Verificar si el email está verificado
        if (!usuario.email_verificado) {
            // Generar nuevo token de verificación
            const newVerificationToken = crypto.randomBytes(32).toString('hex');
            const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await db.run(
                'UPDATE usuarios SET verification_token = ?, verification_token_expires = ? WHERE id = ?',
                [newVerificationToken, verificationTokenExpires, usuario.id]
            );

            // Enviar email de verificación
            const emailResult = await sendVerificationEmail(usuario.email, usuario.nombre, newVerificationToken, req);
            
            if (emailResult.success) {
                console.log('Email de verificación enviado al iniciar sesión:', usuario.email);
            } else {
                console.error('Error al enviar email de verificación al login:', emailResult.error);
            }

            // Redirigir a página de verificación
            return res.render('verify-email', { 
                email: usuario.email, 
                success: emailResult.success ? 'Se ha enviado un email de verificación. Por favor revisa tu bandeja de entrada.' : null,
                error: emailResult.success ? null : 'No se pudo enviar el email de verificación. Contacta al administrador o intenta reenviarlo.'
            });
        }

        // CORRECCIÓN DE COOKIE: Evita asignar "expires = false" para no romper express-session

        if (remember) {
            req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 días
        } else {
            req.session.cookie.maxAge = 1000 * 60 * 60 * 24; // 1 día por defecto
        }

        req.session.user = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email
        };

        // Forzar guardado explícito
        return req.session.save((err) => {
            if (err) {
                console.error('Error al guardar la sesión:', err);
                return res.render('login', { error: 'Error al guardar la sesión. Intente nuevamente.' });
            }
            return res.redirect('/');
        });

    } catch (error) {
        console.error('Error detallado en el login:', error);
        return res.render('login', { error: 'Ocurrió un error inesperado al iniciar sesión.' });
    }
};

export const renderRegister = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    return res.render('register', { error: null });
};

export const processRegister = async (req, res) => {
    const { nombre, email, password, confirmPassword } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    // Validar que las contraseñas coincidan
    if (password !== confirmPassword) {
        return res.render('register', { error: 'Las contraseñas no coinciden.' });
    }

    try {
        const db = await dbPromise;
        const usuarioExistente = await db.get('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)', [cleanEmail]);

        if (usuarioExistente) {
            return res.render('register', { error: 'El correo electrónico ya está registrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generar token de verificación
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

        const result = await db.run(
            'INSERT INTO usuarios (nombre, email, password, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?) RETURNING id',
            [nombre.trim(), cleanEmail, hashedPassword, verificationToken, verificationTokenExpires]
        );

        // Enviar email de verificación con Brevo
        const emailResult = await sendVerificationEmail(cleanEmail, nombre.trim(), verificationToken, req);
        
        if (emailResult.success) {
            console.log('Email de verificación enviado a:', cleanEmail);
        } else {
            console.error('Error al enviar email de verificación:', emailResult.error);
        }

        // Renderizar página de verificación pendiente
        return res.render('verify-email', { 
            email: cleanEmail, 
            success: emailResult.success ? 'Cuenta creada exitosamente. Por favor verifica tu correo electrónico.' : null,
            error: emailResult.success ? null : 'No se pudo enviar el email de verificación automáticamente. Contacta al administrador o intenta reenviarlo.'
        });

    } catch (error) {
        console.error('Error detallado en el registro:', error);
        return res.render('register', { error: 'Ocurrió un error al crear la cuenta.' });
    }
};

export const logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error cerrando sesión:', err);
        }
        res.clearCookie('connect.sid');
        return res.redirect('/');
    });
};

export const renderProfile = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    try {
        const db = await dbPromise;
        const usuario = await db.get('SELECT id, nombre, email FROM usuarios WHERE id = ?', [req.session.user.id]);
        
        if (!usuario) {
            return res.redirect('/auth/login');
        }

        return res.render('profile', { usuario, success: null, error: null });
    } catch (error) {
        console.error('Error al obtener el perfil:', error);
        return res.redirect('/');
    }
};

export const updateProfile = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { nombre, email } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;
        await db.run('UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?', [nombre.trim(), cleanEmail, usuarioId]);

        req.session.user.nombre = nombre.trim();
        req.session.user.email = cleanEmail;

        const usuario = await db.get('SELECT id, nombre, email FROM usuarios WHERE id = ?', [usuarioId]);
        return res.render('profile', { usuario, success: 'Datos actualizados correctamente.', error: null });
    } catch (error) {
        console.error('Error al actualizar el perfil:', error);
        const usuario = { id: usuarioId, nombre, email: cleanEmail };
        return res.render('profile', { usuario, success: null, error: 'El correo electrónico ya está en uso.' });
    }
};

export const updatePassword = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { currentPassword, newPassword } = req.body;
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;
        const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [usuarioId]);

        const passwordValida = await bcrypt.compare(currentPassword, usuario.password);
        if (!passwordValida) {
            return res.render('profile', { usuario, success: null, error: 'La contraseña actual es incorrecta.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.run('UPDATE usuarios SET password = ? WHERE id = ?', [hashedPassword, usuarioId]);

        return res.render('profile', { usuario, success: 'Contraseña actualizada con éxito.', error: null });
    } catch (error) {
        console.error('Error al cambiar la contraseña:', error);
        return res.render('profile', { usuario: req.session.user, success: null, error: 'Ocurrió un error inesperado.' });
    }
};

export const renderVerifyEmail = (req, res) => {
    const { token } = req.params;
    return res.render('verify-email', { token, email: null, success: null, error: null });
};

export const verifyEmail = async (req, res) => {
    const { token } = req.params;

    try {
        const db = await dbPromise;
        const usuario = await db.get(
            'SELECT * FROM usuarios WHERE verification_token = ? AND verification_token_expires > datetime("now")',
            [token]
        );

        if (!usuario) {
            return res.render('verify-email', { 
                token: null, 
                email: null, 
                success: null, 
                error: 'Token inválido o expirado. Por favor solicita un nuevo email de verificación.' 
            });
        }

        if (usuario.email_verificado) {
            return res.render('verify-email', { 
                token: null, 
                email: usuario.email, 
                success: 'Tu correo electrónico ya está verificado.', 
                error: null 
            });
        }

        await db.run(
            'UPDATE usuarios SET email_verificado = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
            [usuario.id]
        );

        // Iniciar sesión automáticamente después de verificación
        req.session.user = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email
        };

        return req.session.save((err) => {
            if (err) {
                console.error('Error al guardar sesión tras verificación:', err);
                return res.render('verify-email', { 
                    token: null, 
                    email: usuario.email, 
                    success: null, 
                    error: 'Error al iniciar sesión. Por favor inicia sesión manualmente.' 
                });
            }
            return res.redirect('/');
        });

    } catch (error) {
        console.error('Error al verificar email:', error);
        return res.render('verify-email', { 
            token: null, 
            email: null, 
            success: null, 
            error: 'Ocurrió un error al verificar el correo electrónico.' 
        });
    }
};

export const resendVerification = async (req, res) => {
    const { email } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    try {
        const db = await dbPromise;
        const usuario = await db.get('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)', [cleanEmail]);

        if (!usuario) {
            return res.render('verify-email', { 
                token: null, 
                email: null, 
                success: null, 
                error: 'No se encontró una cuenta con ese correo electrónico.' 
            });
        }

        if (usuario.email_verificado) {
            return res.render('verify-email', { 
                token: null, 
                email: usuario.email, 
                success: 'Tu correo electrónico ya está verificado. Puedes iniciar sesión.', 
                error: null 
            });
        }

        // Generar nuevo token
        const newVerificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.run(
            'UPDATE usuarios SET verification_token = ?, verification_token_expires = ? WHERE id = ?',
            [newVerificationToken, verificationTokenExpires, usuario.id]
        );

        // Enviar email de verificación
        const emailResult = await sendVerificationEmail(usuario.email, usuario.nombre, newVerificationToken, req);
        
        if (emailResult.success) {
            console.log('Nuevo email de verificación enviado a:', usuario.email);
        } else {
            console.error('Error al reenviar email de verificación:', emailResult.error);
        }

        return res.render('verify-email', { 
            token: null, 
            email: usuario.email, 
            success: emailResult.success ? 'Se ha enviado un nuevo email de verificación. Por favor revisa tu bandeja de entrada.' : null, 
            error: emailResult.success ? null : 'No se pudo enviar el email de verificación. Contacta al administrador o intenta nuevamente.'
        });

    } catch (error) {
        console.error('Error al reenviar verificación:', error);
        return res.render('verify-email', { 
            token: null, 
            email: null, 
            success: null, 
            error: 'Ocurrió un error al reenviar el email de verificación.' 
        });
    }
};