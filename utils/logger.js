const { createLogger, format, transports } = require('winston');
const path = require('path'); // Módulo nativo de Node para manejar rutas físicas

const nivelesSvdrayf = {
    levels: {
        critical: 0,
        error: 1,
        warning: 2,
        info: 3
    }
};

const enmascararDatosSensibles = format((info) => {
    const camposALimpiar = ['password', 'password_hash', 'token', 'token_auth', 'dni', 'hash'];
    if (info.message && typeof info.message === 'object') {
        camposALimpiar.forEach(campo => {
            if (info.message[campo]) info.message[campo] = '********';
        });
    }
    if (typeof info.message === 'string') {
        info.message = info.message.replace(/"password":\s*"[^"]+"/g, '"password":"********"');
        info.message = info.message.replace(/"token":\s*"[^"]+"/g, '"token":"********"');
        info.message = info.message.replace(/Bearer\s[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_=]+\.?[a-zA-Z0-9-_.+/=]*/g, 'Bearer ********');
    }
    return info;
});

const logger = createLogger({
    levels: nivelesSvdrayf.levels,
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        enmascararDatosSensibles(),
        format.printf(({ timestamp, level, modulo, message, userId }) => {
            return `[${timestamp}] [${level.toUpperCase()}] [Módulo: ${modulo || 'SISTEMA'}] [Proc/UID: ${userId || 'ANÓNIMO'}] ➔ ${message}`;
        })
    ),
    transports: [
        new transports.Console(), // Transmisión viva a la terminal/Render
        
        // 🟢 NUEVA ADICIÓN: Guarda los logs automáticamente en un archivo .txt plano
        new transports.File({ 
            filename: path.join(__dirname, '../svdrayf_monitoreo.txt'),
            level: 'info' // Captura 'info' y severidades más altas (error, warning, critical)
        })
    ]
});

module.exports = logger;