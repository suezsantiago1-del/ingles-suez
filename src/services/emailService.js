import SibApiV3Sdk from 'sib-api-v3-sdk';

// Obtener API Key de Brevo desde cualquier variable de entorno disponible
const getBrevoApiKey = () => {
    return process.env.BREVO_API_KEY || 
           process.env.SMTP_PASS || 
           process.env.BREVO_KEY ||
           process.env.SENDINBLUE_API_KEY ||
           '';
};

// Remitente de los mails.
//
// Tiene que ser una dirección de un dominio autenticado en Brevo (DKIM + SPF),
// no un gmail: Brevo firma el mail con el dominio del remitente, y sobre
// gmail.com no se puede publicar una clave DKIM porque el DNS es de Google. Un
// mail que dice venir de gmail.com pero sale de los servidores de Brevo falla
// la alineación DMARC y termina en spam — y acá el mail de verificación es lo
// que habilita la cuenta del alumno.
//
// El fallback al gmail es transitorio, para no romper el deploy viejo mientras
// el dominio no esté autenticado. Una vez que lo esté, se define
// EMAIL_REMITENTE y este fallback deja de usarse.
const getSenderEmail = () => {
    return process.env.EMAIL_REMITENTE ||
           process.env.BREVO_SENDER_EMAIL ||   // nombre anterior
           'suezsantiago1@gmail.com';
};

const getSenderName = () => process.env.EMAIL_REMITENTE_NOMBRE || 'INGLÉS SUEZ';

// no-responder@ no tiene casilla: las respuestas de los alumnos se redirigen
// al mail del profesor para que no se pierdan.
const getReplyTo = () => process.env.EMAIL_RESPUESTAS || process.env.EMAIL_PROFESOR || null;

// Arma sender y replyTo sobre un SendSmtpEmail ya creado.
const aplicarRemitente = (sendSmtpEmail) => {
    sendSmtpEmail.sender = { email: getSenderEmail(), name: getSenderName() };
    const responder = getReplyTo();
    if (responder) sendSmtpEmail.replyTo = { email: responder };
};

// Inicializar cliente de Brevo
const initializeBrevoClient = () => {
    const apiKey = getBrevoApiKey();
    if (!apiKey) {
        console.warn('⚠️  No se encontró API Key de Brevo');
        return null;
    }
    
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKeyAuth = defaultClient.authentications['api-key'];
    apiKeyAuth.apiKey = apiKey;
    
    return new SibApiV3Sdk.TransactionalEmailsApi();
};

export const sendVerificationEmail = async (email, nombre, token, req) => {
    try {
        const apiKey = getBrevoApiKey();
        console.log('Enviando email de verificación con API de Brevo a:', email);
        
        if (!apiKey) {
            return { 
                success: false, 
                error: 'No se encontró API Key de Brevo. Configura BREVO_API_KEY o SMTP_PASS en las variables de entorno.' 
            };
        }
        
        const apiInstance = initializeBrevoClient();
        if (!apiInstance) {
            return { 
                success: false, 
                error: 'No se pudo inicializar el cliente de Brevo' 
            };
        }
        
        const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify/${token}`;
        
        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        aplicarRemitente(sendSmtpEmail);
        sendSmtpEmail.to = [{ email: email, name: nombre }];
        sendSmtpEmail.subject = 'Verifica tu correo electrónico - INGLÉS SUEZ';
        sendSmtpEmail.htmlContent = `
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
        `;

        const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
        
        console.log('Respuesta de Brevo API:', result);
        console.log('Email enviado con messageId:', result.messageId);
        return { success: true, messageId: result.messageId };
        
    } catch (error) {
        console.error('Error enviando email con API de Brevo:', error);
        console.error('Error completo:', error.message);
        console.error('Error response:', error.response);
        return { success: false, error: error.message };
    }
};

export const sendEmail = async (to, subject, html) => {
    try {
        const apiKey = getBrevoApiKey();
        
        if (!apiKey) {
            return { 
                success: false, 
                error: 'No se encontró API Key de Brevo. Configura BREVO_API_KEY o SMTP_PASS en las variables de entorno.' 
            };
        }
        
        const apiInstance = initializeBrevoClient();
        if (!apiInstance) {
            return { 
                success: false, 
                error: 'No se pudo inicializar el cliente de Brevo' 
            };
        }
        
        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        aplicarRemitente(sendSmtpEmail);
        sendSmtpEmail.to = [{ email: to }];
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = html;

        const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
        
        console.log('Email enviado con API de Brevo:', result);
        return { success: true, messageId: result.messageId };
        
    } catch (error) {
        console.error('Error enviando email con API de Brevo:', error);
        return { success: false, error: error.message };
    }
};