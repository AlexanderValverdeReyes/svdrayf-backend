const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

// 1. REGISTRO DE INSPECCIÓN VIAL (Actualizado con ID de Fiscalizador)
router.post('/inspeccion', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 4) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Fiscalizador puede reportar inspecciones viales.' });
    }

    try {
        const { id_turno, tipo_incidencia, descripcion, pasajeros_fisicos, id_boleto_afectado } = req.body;
        
        const conteoPasajeros = parseInt(pasajeros_fisicos, 10);
        if (isNaN(conteoPasajeros) || conteoPasajeros < 0) {
            return res.status(400).json({ status: 'ERROR', message: 'Error Aritmético: La cantidad de pasajeros físicos a bordo debe ser un número entero mayor o igual a cero.' });
        }

        // Se inyecta req.user.id_usuario para asociar de manera mandatoria la autoría del registro
        await pool.query(
            `INSERT INTO incidencias (id_turno, id_boleto, tipo_incidencia, descripcion, pasajeros_fisicos, fecha_hora, id_usuario_fiscalizador)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)`,
            [id_turno, id_boleto_afectado || null, tipo_incidencia || 'NORMAL', descripcion, conteoPasajeros, req.user.id_usuario]
        );

        return res.json({ status: 'OK', message: 'Reporte de fiscalización manual perimetral consolidado correctamente en la central.' });
    } catch (err) {
        if (err.code === '23514') {
            return res.status(400).json({ status: 'ERROR', message: 'Error de Dominio: El tipo de incidencia enviado no pertenece a las categorías autorizadas de auditoría.' });
        }
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo interno al procesar reporte contable de fiscalización.' });
    }
}); 

// 2. VERIFICACIÓN DE BOLETO POR HASH (Exclusivo Top-Level)
router.get('/verificar-boleto', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 4) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Fiscalizador puede verificar boletos.' });
    }

    const { hash } = req.query;
    if (!hash || hash.trim().length === 0) {
        return res.status(400).json({ status: 'ERROR', message: 'Debe proporcionar un código de boleto.' });
    }

    try {
        const result = await pool.query(
            `SELECT 
                b.id_boleto,b.id_turno,t.estado_turno AS estado_turno, b.hash_qr, b.estado_boleto, b.monto_pagado_centavos, 
                b.fecha_emision, b.modalidad_pago,
                u.nombres as cobrador, bus.placa, bus.numero_padron,
                rm.nombre_modalidad as ruta,
                po.nombre_paradero as origen, pd.nombre_paradero as destino
             FROM boleto b
             JOIN turno_viaje t ON b.id_turno = t.id_turno
             JOIN usuario u ON t.id_usuario_cobrador = u.id_usuario
             JOIN bus ON t.id_bus = bus.id_bus
             JOIN ruta_modalidad rm ON t.id_ruta_modalidad = rm.id_ruta_modalidad
             LEFT JOIN tarifario tf ON b.id_tarifario = tf.id_tarifario                                                                                 
             LEFT JOIN paradero po ON tf.id_paradero_origen = po.id_paradero
             LEFT JOIN paradero pd ON tf.id_paradero_destino = pd.id_paradero
             WHERE b.hash_qr = $1
             LIMIT 1`,
            [hash.trim()]
        );

        if (result.rows.length === 0) {
            return res.json({ status: 'OK', data: null });
        }

        return res.json({ status: 'OK', data: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al verificar el boleto.' });
    }
});

// 3. NUEVO ENDPOINT: CARGAR HISTORIAL FILTRADO POR FISCALIZADOR
router.get('/historial-inspecciones', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 4) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Historial exclusivo para personal de fiscalización.' });
    }

    try {
        const result = await pool.query(
            `SELECT i.id_incidencia, i.tipo_incidencia, i.descripcion, i.fecha_hora, i.pasajeros_fisicos,
                    bus.placa, bus.numero_padron
             FROM incidencias i
             JOIN turno_viaje t ON i.id_turno = t.id_turno
             JOIN bus ON t.id_bus = bus.id_bus
             WHERE i.id_usuario_fiscalizador = $1
             ORDER BY i.fecha_hora DESC`,
            [req.user.id_usuario]
        );

        return res.json({ status: 'OK', data: result.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error interno al recopilar la bitácora de inspecciones.' });
    }
});

module.exports = router;