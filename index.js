const express = require('express');
const cors = require('cors');
const pool = require('./db'); // Necesario para el Health Check
require('dotenv').config();

// Inicialización de la aplicación
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Middlewares globales
app.use(cors());
app.use(express.json());

// ==========================================
// ENDPOINT DE CONTROL (RESTAURADO)
// ==========================================
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            status: 'OK',
            message: 'Ecosistema SVDRAYF en línea. Servidor conectado a Neon.tech',
            databaseTime: result.rows[0].now
        });
    } catch (error) {
        res.status(500).json({ status: 'ERROR', message: 'Fallo de BD', error: error.message });
    }
});

// ==========================================
// INYECCIÓN DE CONTROLADORES (MÓDULOS)
// ==========================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/maestros', require('./routes/maestros'));
app.use('/api/operacion', require('./routes/operacion'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/fiscalizacion', require('./routes/fiscalizacion'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/socio', require('./routes/socio'));


// ==========================================
// CONTROL DE RUTAS INEXISTENTES (404 Fallback)
// ==========================================
app.use((req, res) => {
    // ESTA LÍNEA TE AYUDARÁ A DETECTAR EL ERROR EXACTO:
    res.status(404).json({ 
        status: 'ERROR', 
        message: `El endpoint solicitado [${req.method} ${req.url}] no existe en la arquitectura SVDRAYF.` 
    });
});

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` SERVIDOR API REST SVDRAYF OPERATIVO EN EL PUERTO ${PORT}`);
    console.log(`=======================================================`);
});