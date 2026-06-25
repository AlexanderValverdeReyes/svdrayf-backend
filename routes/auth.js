const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const pool = require('../db');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware'); 


// 1. ENDPOINT: LOGIN UNIFICADO (Soportando DNI / Correo + Control de Estado)
router.post('/login', async (req, res) => {
    try {
        const { identificador, password, dispositivo_info } = req.body;

        // Validación perimetral de entrada básica
        if (!identificador || !password) {
            return res.status(400).json({ 
                status: 'ERROR', 
                message: 'Debe ingresar sus credenciales para acceder.' 
            });
        }

        const cleanIdentificador = identificador.trim().toLowerCase();
        const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

        // Buscar por Correo o DNI
        const userQuery = await pool.query(
            'SELECT * FROM usuario WHERE LOWER(correo) = $1 OR dni = $1', 
            [cleanIdentificador]
        );
        
        if (userQuery.rows.length === 0) {
            return res.status(401).json({ 
                status: 'ERROR', 
                message: 'Error: Las credenciales introducidas son incorrectas. Por favor, intente de nuevo.' 
            });
        }

        const user = userQuery.rows[0];

        // [CP20] CONTROL DE SEGURIDAD: Cuenta Inactiva / Dada de baja
        // Si tu tabla usuario maneja una columna "estado" o "activo"
        if (user.estado === false || user.activo === false) {
            return res.status(403).json({
                status: 'ERROR',
                message: 'Acceso denegada: Su cuenta de personal se encuentra inactiva. Comuníquese con el Administrador de la empresa de transporte.'
            });
        }

        // Validación criptográfica de la contraseña
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ 
                status: 'ERROR', 
                message: 'Error: Las credenciales introducidas son incorrectas. Por favor, intente de nuevo.' 
            });
        }

        // Generación del Payload JWT con identificador único JTI (Blindaje Anti-Crash)
        const token = jwt.sign(
            { 
                id_usuario: user.id_usuario, 
                id_rol: user.id_rol,
                requiere_cambio: user.requiere_cambio,
                jti: crypto.randomUUID() 
            },
            process.env.JWT_SECRET,
            { expiresIn: '14h' }
        );

        // Registro del log de sesión para auditoría gerencial
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
        console.error(' Error en Login:', err.message);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno del servidor.' });
    }
});

// 2. ENDPOINT: REGISTRAR SOLICITUD DE RECUPERACIÓN (Cola de Soporte)
router.post('/recover', async (req, res) => {
    try {
        const { identificador } = req.body;

        if (!identificador || !identificador.trim()) {
            return res.status(400).json({ status: 'ERROR', message: 'Debe ingresar su identificador oficial.' });
        }

        const cleanIdentificador = identificador.trim().toLowerCase();

        // 1. Validar existencia del operador en Neon DB
        const userQuery = await pool.query(
            'SELECT id_usuario FROM usuario WHERE LOWER(correo) = $1 OR dni = $1', 
            [cleanIdentificador]
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ 
                status: 'ERROR', 
                message: 'El DNI o correo ingresado no pertenece al personal authorized.' 
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

        // 3. Generar token criptográfico único
        const token_hash = crypto.randomBytes(32).toString('hex');
        const fecha_creacion = new Date();
        const fecha_expiracion = new Date(fecha_creacion.getTime() + 2 * 60 * 60 * 1000); // 2 Horas de vigencia

        // 4. Inserción limpia en base de datos
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
        console.error(' Error en Recuperación:', err.message);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo interno al procesar el token de soporte.' });
    }
});

// 3. ENDPOINT: CAMBIO OBLIGATORIO DE PASSWORD (Con bloqueo anti-DNI)
router.post('/change-forced-password', authMiddleware, async (req, res) => {
    try {
        const { newPassword } = req.body;
        const id_usuario = req.user.id_usuario; 

        if (!newPassword || newPassword.trim().length < 6) {
            return res.status(400).json({ 
                status: 'ERROR', 
                message: 'La nueva llave de acceso debe contener un mínimo de 6 caracteres.' 
            });
        }

        const cleanPassword = newPassword.trim();

        // FILTRO DE SEGURIDAD OPERATIVA: Bloquear contraseñas idénticas al DNI del usuario
        const identityQuery = await pool.query('SELECT dni FROM usuario WHERE id_usuario = $1', [id_usuario]);
        if (identityQuery.rows.length > 0) {
            const userDni = identityQuery.rows[0].dni.trim();
            if (cleanPassword === userDni) {
                return res.status(400).json({
                    status: 'ERROR',
                    message: 'Por políticas estrictas de seguridad, su nueva contraseña no puede ser idéntica a su número de DNI.'
                });
            }
        }

        // Encriptación segura de la credencial definitiva
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(cleanPassword, salt);

        // Liberación del flag mandatorio de cambio
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
        console.error(' Error en cambio forzado:', err.message);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno en el pool de seguridad.' });
    }
});

module.exports = router;