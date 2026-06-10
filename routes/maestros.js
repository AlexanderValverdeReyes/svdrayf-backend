const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/sync', authMiddleware, async (req, res) => {
    try {
        const [buses, paraderos, tiposPasajero, rutas, motivos, empresa] = await Promise.all([
            pool.query(`
                SELECT id_bus, placa, numero_padron, capacidad_pasajeros 
                FROM bus 
                WHERE estado = true 
                  AND id_bus NOT IN (SELECT id_bus FROM turno_viaje WHERE estado_turno = 'ABIERTO')
            `),
            pool.query('SELECT id_paradero, nombre_paradero FROM paradero WHERE estado = true'),
            pool.query('SELECT id_tipo_pasajero, nombre_tipo FROM tipo_pasajero'),
            pool.query('SELECT id_ruta_modalidad, nombre_modalidad FROM ruta_modalidad'),
            pool.query('SELECT id_motivo, descripcion_motivo FROM motivo_anulacion'),
            pool.query('SELECT * FROM configuracion_empresa WHERE id_config = 1')
        ]);

        const tarifario = await pool.query('SELECT * FROM tarifario');

        return res.json({
            status: 'OK',
            data: {
                buses: buses.rows,
                paraderos: paraderos.rows,
                tipos_pasajero: tiposPasajero.rows,
                rutas: rutas.rows,
                motivos_anulacion: motivos.rows,
                configuracion: empresa.rows[0] || null,
                tarifario: tarifario.rows
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo al descargar datos maestros.' });
    }
});

module.exports = router;