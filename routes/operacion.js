// src/routes/operacion.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

// Aperturar Turno de Viaje (RF22)
router.post('/turno/apertura', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 5) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Cobrador autorizado puede gestionar turnos de viaje.' });
    }

    try {
        const { id_bus, id_ruta_modalidad } = req.body;
        const id_usuario_cobrador = req.user.id_usuario;

        // 1. CONTROL PERIMETRAL: Verificar existencia y estado del Bus en Neon DB
        const busCheck = await pool.query(
            'SELECT estado, placa FROM bus WHERE id_bus = $1', 
            [id_bus]
        );

        if (busCheck.rowCount === 0) {
            return res.status(442).json({ 
                status: 'ERROR', 
                message: 'Inconsistencia de Datos: El vehículo seleccionado no existe en el maestro de flota.' 
            });
        }

        // REGLA DE NEGOCIO: Si el bus está dado de baja (estado = false), bloqueamos la apertura
        if (!busCheck.rows[0].estado) {
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

        return res.json({ 
            status: 'OK', 
            message: 'Turno aperturado de manera conforme.', 
            turno: nuevoTurno.rows[0] 
        });

    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({
                status: 'ERROR',
                message: 'Bloqueo Operativo: La unidad de bus o su cuenta de cobrador ya poseen una jornada activa en progreso en la Panamericana.'
            });
        }
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno al abrir turno de viaje.' });
    }
});

// Cerrar Turno de Viaje (RF29)
router.post('/turno/cierre', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 5) {
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
            return res.status(404).json({ status: 'ERROR', message: 'La jornada indexada no existe o ya se encuentra cerrada.' });
        }

        return res.json({ status: 'OK', message: 'Turno de viaje finalizado y montos congelados de forma conforme.', turno: cierre.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al cerrar turno de viaje.' });
    }
});

module.exports = router;