import nodemailer from 'nodemailer';

// Configurar transporter de email
const createTransporter = () => {
    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

    // Si no hay credenciales SMTP configuradas, devolver null
    if (!smtpUser || !smtpPass) {
        console.warn('⚠️  SMTP no configurado. Agrega SMTP_USER y SMTP_PASS en tu archivo .env');
        return null;
    }

    // Usar Gmail como servicio de email (configuración por defecto)
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false, // true para 465, false para otros puertos
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
};

export const sendVerificationEmail = async (email, nombre, token, req) => {
    try {
        const transporter = createTransporter();
        
        // Si no hay transporter configurado, devolver error claro
        if (!transporter) {
            return { 
                success: false, 
                error: 'SMTP no configurado. Agrega SMTP_USER y SMTP_PASS en tu archivo .env' 
            };
        }

        const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify/${token}`;
        
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"INGLÉS SUEZ" <noreply@ingleessuez.com>',
            to: email,
            subject: 'Verifica tu correo electrónico - INGLÉS SUEZ',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Verificar Email - INGLÉS SUEZ</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px;">
                    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="background: linear-gradient(135deg, #0b2238 0%, #184168 100%); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 24px;">INGLÉS SUEZ</h1>
                            <p style="color: #a4c4de; margin: 10px 0 0;">Plataforma de Aprendizaje de Inglés</p>
                        </div>
                        
                        <div style="padding: 40px 30px;">
                            <h2 style="color: #0b2238; margin-top: 0;">¡Bienvenido, ${nombre}!</h2>
                            <p style="color: #4a5568; line-height: 1.6;">
                                Gracias por registrarte en INGLÉS SUEZ. Para completar tu registro y poder acceder a todos nuestros cursos, necesitamos verificar tu correo electrónico.
                            </p>
                            
                            <div style="background: #f0f9ff; border-left: 4px solid #184168; padding: 20px; margin: 30px 0; border-radius: 4px;">
                                <p style="color: #0b2238; margin: 0;">
                                    <strong>¿Por qué necesito verificar mi email?</strong><br>
                                    Esto nos ayuda a proteger tu cuenta y asegurar que eres tú quien está registrando.
                                </p>
                            </div>
                            
                            <div style="text-align: center; margin: 40px 0;">
                                <a href="${verificationUrl}" style="display: inline-block; background: #184168; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                                    Verificar mi Correo Electrónico
                                </a>
                            </div>
                            
                            <p style="color: #718096; font-size: 14px; text-align: center; margin: 30px 0;">
                                O copia y pega este enlace en tu navegador:<br>
                                <code style="background: #f7fafc; padding: 10px; border-radius: 4px; display: inline-block; word-break: break-all;">${verificationUrl}</code>
                            </p>
                            
                            <p style="color: #4a5568; font-size: 14px; text-align: center; margin: 20px 0;">
                                Este enlace expirará en 24 horas.
                            </p>
                            
                            <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center;">
                                <p style="color: #718096; margin: 0; font-size: 14px;">
                                    Si no creaste esta cuenta, puedes ignorar este email.
                                </p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado:', info.messageId);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('Error enviando email:', error);
        return { success: false, error: error.message };
    }
};

export const sendEmail = async (to, subject, html) => {
    try {
        const transporter = createTransporter();
        
        // Si no hay transporter configurado, devolver error claro
        if (!transporter) {
            return { 
                success: false, 
                error: 'SMTP no configurado. Agrega SMTP_USER y SMTP_PASS en tu archivo .env' 
            };
        }

        const mailOptions = {
            from: process.env.EMAIL_FROM || '"INGLÉS SUEZ" <noreply@ingleessuez.com>',
            to,
            subject,
            html
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email enviado:', info.messageId);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('Error enviando email:', error);
        return { success: false, error: error.message };
    }
};