// src/routes/sync.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/boletos', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 5) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo el personal de cobro puede sincronizar boletos.' });
    }

    const client = await pool.connect();
    try {
        const { boletos } = req.body; 
        if (!Array.isArray(boletos) || boletos.length === 0) {
            return res.status(400).json({ status: 'ERROR', message: 'El lote de datos asíncronos está vacío.' });
        }

        await client.query('BEGIN'); 

        for (const boleto of boletos) {
    const targetTarifario = (boleto.id_tarifario && parseInt(boleto.id_tarifario, 10) > 0) ? parseInt(boleto.id_tarifario, 10) : 3;


    const alertaAuditoria = (boleto.estado_boleto === 'ANULADO') ? true : (boleto.alerta_auditoria_qr || false);

    await client.query(
        `INSERT INTO boleto (
            id_boleto, id_turno, id_tarifario, monto_pagado_centavos, modalidad_pago, 
            estado_boleto, hash_qr, alerta_auditoria_qr, fecha_emision, estado_sync, 
            es_reimpresion, id_boleto_original, id_motivo_anulacion, fecha_anulacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SINCRONIZADO', $10, $11, $12, $13)
        ON CONFLICT (id_boleto) DO UPDATE SET 
            estado_boleto = EXCLUDED.estado_boleto,
            id_motivo_anulacion = EXCLUDED.id_motivo_anulacion,
            fecha_anulacion = EXCLUDED.fecha_anulacion,
            alerta_auditoria_qr = EXCLUDED.alerta_auditoria_qr`, 
        [
            boleto.id_boleto, 
            boleto.id_turno, 
            targetTarifario, 
            boleto.monto_pagado_centavos,
            boleto.modalidad_pago, 
            boleto.estado_boleto, 
            boleto.hash_qr, 
            alertaAuditoria, // Pasamos la constante calculada en lugar del fallback antiguo
            boleto.fecha_emision, 
            boleto.es_reimpresion || false, 
            boleto.id_boleto_original || null,
            boleto.id_motivo_anulacion || null, 
            boleto.fecha_anulacion || null
        ]
    );

            if (boleto.estado_boleto === 'ANULADO') {
                await client.query(
                    `INSERT INTO anulacion_boleto (id_boleto, id_motivo, fecha_anulacion)
                     VALUES ($1, $2, $3) 
                     ON CONFLICT (id_boleto) DO UPDATE SET id_motivo = EXCLUDED.id_motivo`,
                    [boleto.id_boleto, boleto.id_motivo_anulacion || 1, boleto.fecha_anulacion || new Date()]
                );
            }
        }

        await client.query('COMMIT');
        return res.json({ status: 'OK', message: `Lote de ${boletos.length} boletos sincronizado de manera exitosa.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(' Fallo en sincronización masiva detectado en logs:', err.message);
        

        // Empaquetamos el objeto nativo de error de Postgres para que la app sepa exactamente qué pasó
        return res.status(500).json({ 
            status: 'ERROR', 
            message: 'Fallo de integridad en Neon DB PostgreSQL',
            error_code: err.code,               
            error_detail: err.detail,            
            error_constraint: err.constraint,    
            error_native: err.message
        });
    } finally {
        client.release();
    }
});

module.exports = router;