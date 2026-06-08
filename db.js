const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Obligatorio para conectar de forma segura con Neon.tech desde fuera
    },
    sslmode: 'verify-full' // 👈 AGREGA ESTA LÍNEA AQUÍ
});

module.exports = pool;