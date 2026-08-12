import bcrypt from 'bcrypt';
import dbPromise from '../config/database.js';

export const renderLogin = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    return res.render('login', { error: null });
};

export const processLogin = async (req, res) => {
    const { email, password, remember } = req.body;

    try {
        const db = await dbPromise;
        const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);

        if (!usuario) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos.' });
        }

        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.render('login', { error: 'Correo electrónico o contraseña incorrectos.' });
        }

        if (remember) {
            req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
        } else {
            req.session.cookie.expires = false;
        }

        req.session.user = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email
        };

        return res.redirect('/');
    } catch (error) {
        console.error('Error en el login:', error);
        return res.render('login', { error: 'Ocurrió un error inesperado.' });
    }
};

export const renderRegister = (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    return res.render('register', { error: null });
};

export const processRegister = async (req, res) => {
    const { nombre, email, password } = req.body;

    try {
        const db = await dbPromise;
        const usuarioExistente = await db.get('SELECT id FROM usuarios WHERE email = ?', [email]);

        if (usuarioExistente) {
            return res.render('register', { error: 'El correo electrónico ya está registrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.run(
            'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
            [nombre, email, hashedPassword]
        );

        req.session.user = {
            id: result.lastID,
            nombre,
            email
        };

        return res.redirect('/');
    } catch (error) {
        console.error('Error en el registro:', error);
        return res.render('register', { error: 'Ocurrió un error al crear la cuenta.' });
    }
};

export const logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
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
    const usuarioId = req.session.user.id;

    try {
        const db = await dbPromise;
        await db.run('UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?', [nombre, email, usuarioId]);

        req.session.user.nombre = nombre;
        req.session.user.email = email;

        const usuario = await db.get('SELECT id, nombre, email FROM usuarios WHERE id = ?', [usuarioId]);
        return res.render('profile', { usuario, success: 'Datos actualizados correctamente.', error: null });
    } catch (error) {
        console.error('Error al actualizar el perfil:', error);
        const usuario = { id: usuarioId, nombre, email };
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