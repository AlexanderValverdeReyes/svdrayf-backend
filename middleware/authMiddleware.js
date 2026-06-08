const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = function(req, res, next) {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ status: 'ERROR', message: 'Acceso denegado. No se proporcionó un token.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ status: 'ERROR', message: 'Formato de token inválido. Use Bearer [Token]' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        
        next();
    } catch (err) {
        return res.status(401).json({ status: 'ERROR', message: 'Token inválido o expirado.' });
    }
    if (req.user && req.user.requiere_cambio && req.path !== '/change-forced-password') {
    return res.status(401).json({ 
        status: 'ERROR', 
        message: 'Acceso denegado. Es mandatorio completar el cambio de contraseña provisional.' 
    });
}
};