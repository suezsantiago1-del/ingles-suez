import bcrypt from 'bcrypt';
import dbPromise from '../config/database.js';
import crypto from 'crypto';
import { sendVerificationEmail, sendEmail } from '../services/emailService.js';

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

        console.log('Usuario encontrado:', { id: usuario.id, email: usuario.email, email_verificado: usuario.email_verificado });

        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos.' });
        }

        // Verificar si el email está verificado
        if (!usuario.email_verificado) {
            console.log('Email no verificado, enviando email de verificación...');
            
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
        } else {
            console.log('Email ya verificado, permitiendo login...');
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

    console.log('Intento de registro:', { nombre, email: cleanEmail });

    // Validar que las contraseñas coincidan
    if (password !== confirmPassword) {
        return res.render('register', { error: 'Las contraseñas no coinciden.' });
    }

    try {
        const db = await dbPromise;
        const usuarioExistente = await db.get('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?)', [cleanEmail]);

        if (usuarioExistente) {
            console.log('Usuario ya existe:', cleanEmail);
            return res.render('register', { error: 'El correo electrónico ya está registrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Generar token de verificación
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

        console.log('Creando usuario con token de verificación...');

        const result = await db.run(
            'INSERT INTO usuarios (nombre, email, password, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?) RETURNING id',
            [nombre.trim(), cleanEmail, hashedPassword, verificationToken, verificationTokenExpires]
        );

        console.log('Usuario creado con ID:', result.lastID);
        console.log('Enviando email de verificación...');

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

    console.log('Intentando verificar email con token:', token);

    try {
        const db = await dbPromise;
        const usuario = await db.get(
            'SELECT * FROM usuarios WHERE verification_token = ? AND verification_token_expires > NOW()',
            [token]
        );

        console.log('Usuario encontrado:', usuario ? { id: usuario.id, email: usuario.email, email_verificado: usuario.email_verificado } : null);

        if (!usuario) {
            console.log('Token inválido o expirado');
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

export const renderForgotPassword = (req, res) => {
    return res.render('forgot-password', { error: null, success: null });
};

export const processForgotPassword = async (req, res) => {
    const { email } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    try {
        const db = await dbPromise;
        const usuario = await db.get('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)', [cleanEmail]);

        if (!usuario) {
            // Por seguridad, no revelamos si el email existe o no
            return res.render('forgot-password', { 
                error: null, 
                success: 'Si el correo electrónico está registrado, recibirás un email con instrucciones para restablecer tu contraseña.' 
            });
        }

        // Generar token de recuperación
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hora

        await db.run(
            'UPDATE usuarios SET verification_token = ?, verification_token_expires = ? WHERE id = ?',
            [resetToken, resetTokenExpires, usuario.id]
        );

        const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password/${resetToken}`;

        const emailResult = await sendEmail(
            usuario.email,
            'Restablecer tu contraseña - INGLÉS SUEZ',
            `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Restablecer Contraseña - INGLÉS SUEZ</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="background: linear-gradient(135deg, #0b2238 0%, #184168 100%); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">INGLÉS SUEZ</h1>
                            <p style="color: #a4c4de; margin: 10px 0 0;">Plataforma de Aprendizaje de Inglés</p>
                        </div>
                        
                        <div style="padding: 40px 30px;">
                            <h2 style="color: #0b2238; margin-top: 0;">Restablecer tu contraseña</h2>
                            <p style="color: #4a5568; line-height: 1.6;">
                                Hola ${usuario.nombre}, hemos recibido una solicitud para restablecer tu contraseña.
                            </p>
                            
                            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 30px 0; border-radius: 4px;">
                                <p style="color: #856404; margin: 0;">
                                    <strong>¿No solicitaste esto?</strong><br>
                                    Ignora este email y tu contraseña permanecerá sin cambios.
                                </p>
                            </div>
                            
                            <div style="text-align: center; margin: 40px 0;">
                                <a href="${resetUrl}" style="display: inline-block; background: #184168; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                                    Restablecer mi Contraseña
                                </a>
                            </div>
                            
                            <p style="color: #718096; font-size: 14px; text-align: center; margin: 30px 0;">
                                O copia y pega este enlace en tu navegador:<br>
                                <code style="background: #f7fafc; padding: 10px; border-radius: 4px; display: inline-block; word-break: break-all;">${resetUrl}</code>
                            </p>
                            
                            <p style="color: #4a5568; font-size: 14px; text-align: center; margin: 20px 0;">
                                Este enlace expirará en 1 hora.
                            </p>
                        </div>
                    </div>
                </body>
                </html>
            `
        );

        if (emailResult.success) {
            console.log('Email de recuperación enviado a:', usuario.email);
        } else {
            console.error('Error al enviar email de recuperación:', emailResult.error);
        }

        return res.render('forgot-password', { 
            error: null, 
            success: 'Si el correo electrónico está registrado, recibirás un email con instrucciones para restablecer tu contraseña.' 
        });

    } catch (error) {
        console.error('Error al procesar recuperación de contraseña:', error);
        return res.render('forgot-password', { 
            error: null, 
            success: 'Si el correo electrónico está registrado, recibirás un email con instrucciones para restablecer tu contraseña.' 
        });
    }
};

export const renderResetPassword = (req, res) => {
    const { token } = req.params;
    return res.render('reset-password', { token, error: null, success: null });
};

export const processResetPassword = async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.render('reset-password', { 
            token, 
            error: 'Las contraseñas no coinciden.', 
            success: null 
        });
    }

    if (password.length < 6) {
        return res.render('reset-password', { 
            token, 
            error: 'La contraseña debe tener al menos 6 caracteres.', 
            success: null 
        });
    }

    try {
        const db = await dbPromise;
        const usuario = await db.get(
            'SELECT * FROM usuarios WHERE verification_token = ? AND verification_token_expires > NOW()',
            [token]
        );

        if (!usuario) {
            return res.render('reset-password', { 
                token: null, 
                error: 'Token inválido o expirado. Por favor solicita un nuevo email de recuperación.', 
                success: null 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.run(
            'UPDATE usuarios SET password = ?, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
            [hashedPassword, usuario.id]
        );

        return res.render('login', { 
            error: null, 
            success: 'Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión.' 
        });

    } catch (error) {
        console.error('Error al restablecer contraseña:', error);
        return res.render('reset-password', { 
            token: null, 
            error: 'Ocurrió un error al restablecer la contraseña. Por favor intenta nuevamente.', 
            success: null 
        });
    }
};