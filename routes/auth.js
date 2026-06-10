const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware'); 
// Registro de usuarios de prueba (Utilizar en el setup inicial)
router.post('/register-test', async (req, res) => {
    try {
        const { dni, nombres, correo, password, id_rol } = req.body;
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            `INSERT INTO usuario (dni, nombres, correo, password_hash, requiere_cambio, id_rol) 
             VALUES ($1, $2, $3, $4, false, $5) RETURNING id_usuario, nombres, correo`,
            [dni, nombres, correo, password_hash, id_rol]
        );
        return res.json({ status: 'OK', message: 'Usuario creado exitosamente', user: newUser.rows[0] });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// Login Unificado 
router.post('/login', async (req, res) => {
    try {
        const { identificador, password, dispositivo_info } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

        // Buscar por Correo o DNI
        const userQuery = await pool.query('SELECT * FROM usuario WHERE correo = $1 OR dni = $1', [identificador]);
        if (userQuery.rows.length === 0) {
            return res.status(401).json({ status: 'ERROR', message: 'Credenciales incorrectas.' });
        }

        const user = userQuery.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ status: 'ERROR', message: 'Credenciales incorrectas.' });
        }

        // Generar Token de acceso
        const token = jwt.sign(
            { 
        id_usuario: user.id_usuario, 
        id_rol: user.id_rol,
        requiere_cambio: user.requiere_cambio 
    },
    process.env.JWT_SECRET,
    { expiresIn: '14h' }
        );

        // Registrar la sesión en la base de datos para auditoría
        const fechaInicio = new Date();
        const fechaExpiracion = new Date(fechaInicio.getTime() + 14 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO sesion_usuario (id_usuario, fecha_inicio, fecha_expiracion, ip_direccion, dispositivo_info, token_identificador, activo)
             VALUES ($1, $2, $3, $4, $5, $6, true)`,
            [user.id_usuario, fechaInicio, fechaExpiracion, ip, dispositivo_info || 'Unknown Device', token]
        );

        return res.json({
            status: 'OK',
            message: 'Autenticación exitosa',
            token,
            usuario: {
                id_usuario: user.id_usuario,
                nombres: user.nombres,
                id_rol: user.id_rol,
                requiere_cambio: user.requiere_cambio
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno del servidor.' });
    }
});
router.post('/recover', async (req, res) => {
    try {
        const { identificador } = req.body;

        if (!identificador) {
            return res.status(400).json({ status: 'ERROR', message: 'Debe ingresar su identificador oficial.' });
        }

        // 1. Validar existencia del operador en Neon DB
        const userQuery = await pool.query(
            'SELECT id_usuario FROM usuario WHERE correo = $1 OR dni = $1', 
            [identificador.trim()]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ 
                status: 'ERROR', 
                message: 'El DNI o correo ingresado no pertenece al personal autorizado.' 
            });
        }

        const id_usuario = userQuery.rows[0].id_usuario;

        // 2. Mitigar saturación: Verificar si ya existe una solicitud activa en las últimas 2 horas
        const pendingCheck = await pool.query(
            `SELECT id_token FROM token_recuperacion 
             WHERE id_usuario = $1 AND usado = false AND fecha_expiracion > NOW()`,
            [id_usuario]
        );

        if (pendingCheck.rows.length > 0) {
            return res.status(400).json({ 
                status: 'ERROR', 
                message: 'Ya cuenta con una solicitud activa en la cola de soporte del Administrador.' 
            });
        }

        // 3. Generar token_hash único usando el módulo criptográfico nativo de Node.js
        const crypto = require('crypto');
        const token_hash = crypto.randomBytes(32).toString('hex');

        // Definir ciclo de vida del token (2 horas de vigencia)
        const fecha_creacion = new Date();
        const fecha_expiracion = new Date(fecha_creacion.getTime() + 2 * 60 * 60 * 1000);

        // 4. Inserción limpia en tu tabla token_recuperacion
        await pool.query(
            `INSERT INTO token_recuperacion (id_usuario, token_hash, fecha_creacion, fecha_expiracion, usado)
             VALUES ($1, $2, $3, $4, false)`,
            [id_usuario, token_hash, fecha_creacion, fecha_expiracion]
        );

        return res.json({
            status: 'OK',
            message: 'Solicitud registrada. Comuníquese con el Administrador para obtener su PIN temporal.'
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo interno al procesar el token de soporte.' });
    }
});

// REGLA DE NEGOCIO: CAMBIO OBLIGATORIO DE PASSWORD 
router.post('/change-forced-password', authMiddleware, async (req, res) => {
    try {
        const { newPassword } = req.body;
        
        // El id_usuario se extrae de manera íntegra desde el token JWT validado por el authMiddleware
        const id_usuario = req.user.id_usuario; 

        if (!newPassword || newPassword.trim().length < 6) {
            return res.status(400).json({ 
                status: 'ERROR', 
                message: 'La nueva llave de acceso debe contener un mínimo de 6 caracteres.' 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword.trim(), salt);

        //   ACTUALIZACIÓN ATÓMICA EN POSTGRESQL:
        // - Se guarda el password_hash robusto.
        // - Se limpia el campo pendiente cambiando requiere_cambio a false.
        await pool.query(
            `UPDATE usuario 
             SET password_hash = $1, requiere_cambio = false 
             WHERE id_usuario = $2`,
            [password_hash, id_usuario]
        );

        return res.json({ 
            status: 'OK', 
            message: 'Credencial corporativa encriptada y actualizada de forma conforme.' 
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno en el pool de seguridad de Neon DB.' });
    }
});
module.exports = router;