// src/routes/fiscalizacion.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/inspeccion', authMiddleware, async (req, res) => {
    //  CONTROL DE PERFIL: Solo un Fiscalizador (Rol 4) puede emitir reportes de carretera
    if (req.user.id_rol !== 4) {
        return res.status(403).json({ status: 'ERROR', message: 'Acceso Denegado: Solo un Fiscalizador puede reportar inspecciones viales.' });
    }

    try {
        // ADAPTACIÓN HARDWARE Y PASO 6 NEON DB:
        // Se descartan los bucles de escaneo de cámara QR. El inspector envía observaciones,
        // el id_turno bajo control, tipo de incidencia detectada visualmente y pasajeros_fisicos contados a bordo.
        const { id_turno, tipo_incidencia, descripcion, pasajeros_fisicos, id_boleto_afectado } = req.body;
        
        //  CANDADO ARITMÉTICO: Validamos que las pasajeros_fisicos cumplan con la restricción CHECK de Neon DB >= 0
        const conteoPasajeros = parseInt(pasajeros_fisicos, 10);
        if (isNaN(conteoPasajeros) || conteoPasajeros < 0) {
            return res.status(400).json({ status: 'ERROR', message: 'Error Aritmético: La cantidad de pasajeros físicos a bordo debe ser un número entero mayor o igual a cero.' });
        }

        // Insertamos directamente el reporte forense en la tabla incidencias mapeando pasajeros_fisicos
        await pool.query(
            `INSERT INTO incidencias (id_turno, id_boleto, tipo_incidencia, descripcion, pasajeros_fisicos, fecha_hora)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [id_turno, id_boleto_afectado || null, tipo_incidencia || 'NORMAL', descripcion, conteoPasajeros]
        );

        return res.json({ status: 'OK', message: 'Reporte de fiscalización manual perimetral consolidado correctamente en la central.' });
    } catch (err) {
        // Captura de violaciones de restricciones CHECK de tipo_incidencia del Paso 6
        if (err.code === '23514') {
            return res.status(400).json({ status: 'ERROR', message: 'Error de Dominio: El tipo de incidencia enviado no pertenece a las categorías autorizadas de auditoría.' });
        }
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo interno al procesar reporte contable de fiscalización.' });
    }
});

module.exports = router;