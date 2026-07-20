// src/routes/operacion.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

// Aperturar Turno de Viaje (RF22)
router.post('/turno/apertura', authMiddleware, async (req, res) => {
    const id_usuario_cobrador = req.user ? req.user.id_usuario : 'ANÓNIMO';

    if (req.user.id_rol !== 5) {
        // LOG SEVERIDAD: WARNING (Intento de acceso no lícito por rol
        logger.warning({
            modulo: 'GESTION_TURNOS',
            userId: id_usuario_cobrador,
            message: 'Acceso Denegado: Usuario sin privilegios intentó ejecutar la operación [Aperturar Turno].'
        });
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Cobrador autorizado puede gestionar turnos de viaje.' });
    }

    try {
        const { id_bus, id_ruta_modalidad } = req.body;

        // 1. CONTROL PERIMETRAL: Verificar existencia y estado del Bus en Neon DB
        const busCheck = await pool.query(
            'SELECT estado, placa FROM bus WHERE id_bus = $1', 
            [id_bus]
        );

        if (busCheck.rowCount === 0) {
            // LOG SEVERIDAD: ERROR (Inconsistencia referencial en maestros)
            logger.error({
                modulo: 'GESTION_TURNOS',
                userId: id_usuario_cobrador,
                message: `Inconsistencia de Datos: Intento de [Aperturar Turno] vinculando un Bus ID ${id_bus} inexistente.`
            });
            return res.status(442).json({ 
                status: 'ERROR', 
                message: 'Inconsistencia de Datos: El vehículo seleccionado no existe en el maestro de flota.' 
            });
        }

        // REGLA DE NEGOCIO: Si el bus está dado de baja (estado = false), bloqueamos la apertura
        if (!busCheck.rows[0].estado) {
            //  LOG SEVERIDAD: WARNING (Bloqueo preventivo por regla operacional)
            logger.warning({
                modulo: 'GESTION_TURNOS',
                userId: id_usuario_cobrador,
                message: `Bloqueo de Jornada: Operario intentó [Aperturar Turno] en unidad dada de baja Placa: [${busCheck.rows[0].placa}].`
            });
            return res.status(400).json({ 
                status: 'ERROR', 
                message: `Bloqueo de Jornada: El autobús con placa [${busCheck.rows[0].placa}] ha sido dado de baja por la administración. No se permiten operaciones.` 
            });
        }

        // 2. Si el bus está activo, intentamos la inserción atómica directa. 
        // Neon DB validará duplicidad con 'idx_bus_turno_activo'
        const nuevoTurno = await pool.query(
            `INSERT INTO turno_viaje (id_bus, id_usuario_cobrador, id_ruta_modalidad, fecha_apertura, estado_turno)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'ABIERTO') RETURNING *`,
            [id_bus, id_usuario_cobrador, id_ruta_modalidad]
        );

        //  LOG SEVERIDAD: INFO (Operación atómica transaccional exitosa)
        logger.info({
            modulo: 'GESTION_TURNOS',
            userId: id_usuario_cobrador,
            message: `Operación [Aperturar Turno] CONFORME. Unidad Placa: [${busCheck.rows[0].placa}] vinculada exitosamente.`
        });

        return res.json({ 
            status: 'OK', 
            message: 'Turno aperturado de manera conforme.', 
            turno: nuevoTurno.rows[0] 
        });

    } catch (err) {
        if (err.code === '23505') {
            //  LOG SEVERIDAD: WARNING (Colisión por concurrencia o doble turno en pasillo)
            logger.warning({
                modulo: 'GESTION_TURNOS',
                userId: id_usuario_cobrador,
                message: `Bloqueo Operativo: Intento de duplicar jornada activa (Llave duplicada PostgreSQL en idx_bus_turno_activo).`
            });
            return res.status(409).json({
                status: 'ERROR',
                message: 'Bloqueo Operativo: La unidad de bus o su cuenta de cobrador ya poseen una jornada activa en progreso en la Panamericana.'
            });
        }
        
        //  LOG SEVERIDAD: CRITICAL (Falla total de infraestructura cloud o pool de conexiones roto)
        logger.log('critical', {
            modulo: 'GESTION_TURNOS',
            userId: id_usuario_cobrador,
            message: `CRITICAL FAIL: Excepción no controlada en pasarela Postgres. Stack trace: ${err.message}`
        });
        return res.status(500).json({ status: 'ERROR', message: 'Error interno al abrir turno de viaje.' });
    }
});

// Cerrar Turno de Viaje (RF29)
router.post('/turno/cierre', authMiddleware, async (req, res) => {
    const id_usuario_cobrador = req.user ? req.user.id_usuario : 'ANÓNIMO';

    if (req.user.id_rol !== 5) {
        //  LOG SEVERIDAD: WARNING (Intento lícito fallido de rol)
        logger.warning({
            modulo: 'LIQUIDACION_CAJA',
            userId: id_usuario_cobrador,
            message: 'Acceso Denegado: Usuario sin privilegios intentó ejecutar la operación [Cerrar Turno].'
        });
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Cobrador autorizado puede finalizar turnos.' });
    }

    try {
        const { id_turno } = req.body;

        const cierre = await pool.query(
            `UPDATE turno_viaje 
             SET fecha_cierre = CURRENT_TIMESTAMP, estado_turno = 'CERRADO' 
             WHERE id_turno = $1 AND estado_turno = 'ABIERTO' RETURNING *`,
            [id_turno]
        );

        if (cierre.rowCount === 0) {
            // LOG SEVERIDAD: WARNING (Intento de re-cerrar o ID corrupto enviado desde el cliente)
            logger.warning({
                modulo: 'LIQUIDACION_CAJA',
                userId: id_usuario_cobrador,
                message: `Bloqueo de Cierre: Solicitud rechazada. El Turno ID ${id_turno} ya se encuentra CERRADO o es inexistente.`
            });
            return res.status(404).json({ status: 'ERROR', message: 'La jornada indexada no existe o ya se encuentra cerrada.' });
        }

        //  LOG SEVERIDAD: INFO (Consolidación contable conforme)
        logger.info({
            modulo: 'LIQUIDACION_CAJA',
            userId: id_usuario_cobrador,
            message: `Operación [Cerrar Turno] CONFORME. Caja congelada y arqueo cerrado exitosamente para Turno ID: ${id_turno}.`
        });

        return res.json({ status: 'OK', message: 'Turno de viaje finalizado y montos congelados de forma conforme.', turno: cierre.rows[0] });
    } catch (err) {
        // LOG SEVERIDAD: CRITICAL (Error de base de datos)
        logger.log('critical', {
            modulo: 'LIQUIDACION_CAJA',
            userId: id_usuario_cobrador,
            message: `CRITICAL FAIL: Aborto drástico en actualización de cierre. Stack: ${err.message}`
        });
        return res.status(500).json({ status: 'ERROR', message: 'Error al cerrar turno de viaje.' });
    }
});

module.exports = router;