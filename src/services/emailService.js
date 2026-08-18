import nodemailer from 'nodemailer';

// Configurar transporter de email usando las variables SMTP existentes
const createTransporter = () => {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    console.log('Configurando SMTP:', {
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        passConfigured: !!smtpPass
    });

    // Si no hay credenciales SMTP configuradas, devolver null
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        console.warn('⚠️  SMTP no configurado completamente. Se requieren SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS');
        return null;
    }

    const port = parseInt(smtpPort);
    
    return nodemailer.createTransport({
        host: smtpHost,
        port: port,
        secure: port === 465, // true para 465 (SSL), false para otros (TLS)
        tls: {
            rejectUnauthorized: false, // Permitir certificados autofirmados si es necesario
            minVersion: 'TLSv1.2'
        },
        auth: {
            user: smtpUser,
            pass: smtpPass
        },
        debug: true, // Habilitar logs de debug
        logger: true // Loguear actividad SMTP
    });
};

export const sendVerificationEmail = async (email, nombre, token, req) => {
    try {
        const transporter = createTransporter();
        
        // Si no hay transporter configurado, devolver error claro
        if (!transporter) {
            return { 
                success: false, 
                error: 'SMTP no configurado. Se requieren SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS en las variables de entorno.' 
            };
        }

        const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify/${token}`;
        const senderEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@ingleessuez.com';
        
        console.log('Enviando email de verificación a:', email);
        console.log('URL de verificación:', verificationUrl);
        
        const mailOptions = {
            from: senderEmail,
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
        console.log('Email enviado exitosamente:', info.messageId);
        console.log('Respuesta del servidor:', info.response);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('Error enviando email:', error);
        console.error('Error completo:', error.message);
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
                error: 'SMTP no configurado. Se requieren SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS en las variables de entorno.' 
            };
        }

        const senderEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@ingleessuez.com';
        
        const mailOptions = {
            from: senderEmail,
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