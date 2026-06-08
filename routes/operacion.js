// src/routes/sync.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/boletos', authMiddleware, async (req, res) => {
    //  CONTROL DE PERFIL: Acción exclusiva para cobradores móviles
    if (req.user.id_rol !== 5) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Acción exclusiva para Cobradores corporativos.' });
    }

    const client = await pool.connect();
    try {
        const { boletos } = req.body; 
        if (!Array.isArray(boletos) || boletos.length === 0) {
            return res.status(400).json({ status: 'ERROR', message: 'El lote de datos asíncronos está vacío.' });
        }

        await client.query('BEGIN'); 

        for (const boleto of boletos) {
            // Inserción idempotente: Si el boleto ya subió por reintentos de red, actualiza estado sin duplicar montos
            await client.query(
                `INSERT INTO boleto (
                    id_boleto, id_turno, id_tarifario, monto_pagado_centavos, modalidad_pago, 
                    estado_boleto, hash_qr, alerta_auditoria_qr, fecha_emision, estado_sync, 
                    es_reimpresion, id_boleto_original, id_motivo_anulacion, fecha_anulacion
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SINCRONIZADO', $10, $11, $12, $13)
                ON CONFLICT (id_boleto) DO UPDATE SET estado_boleto = EXCLUDED.estado_boleto`,
                [
                    boleto.id_boleto, boleto.id_turno, boleto.id_tarifario, boleto.monto_pagado_centavos,
                    boleto.modalidad_pago, boleto.estado_boleto, boleto.hash_qr, boleto.alerta_auditoria_qr || false,
                    boleto.fecha_emision, boleto.es_reimpresion || false, boleto.id_boleto_original || null,
                    boleto.id_motivo_anulacion || null, boleto.fecha_anulacion || null
                ]
            );

            if (boleto.estado_boleto === 'ANULADO') {
                await client.query(
                    `INSERT INTO anulacion_boleto (id_boleto, id_motivo, fecha_anulacion)
                     VALUES ($1, $2, $3) ON CONFLICT (id_boleto) DO NOTHING`,
                    [boleto.id_boleto, boleto.id_motivo_anulacion || 1, boleto.fecha_anulacion || new Date()]
                );
            }
        }

        await client.query('COMMIT');
        return res.json({ status: 'OK', message: `Lote de ${boletos.length} transacciones en Soles sincronizado con éxito.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Fallo en sincronización masiva:', err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo interno en el lote transaccional de Neon DB.' });
    } finally {
        client.release();
    }
});

// Sincronización de Incidencias físicas de Hardware (RF30)
router.post('/incidencias', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 5) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Módulo de incidencias restringido a Cobradores.' });
    }

    try {
        const { id_turno, id_boleto, tipo_incidencia, descripcion } = req.body;
        await pool.query(
            `INSERT INTO incidencias (id_turno, id_boleto, tipo_incidencia, descripcion, fecha_hora)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [id_turno, id_boleto || null, tipo_incidencia, descripcion]
        );
        return res.json({ status: 'OK', message: 'Incidencia técnica registrada en el log central del terminal.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al procesar reporte técnico.' });
    }
});

module.exports = router;