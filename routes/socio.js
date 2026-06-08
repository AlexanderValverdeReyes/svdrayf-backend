// src/routes/socio.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

// ========================================================
// DASHBOARD DEL SOCIO (KPIs, gráfico de rutas, históricos)
// ========================================================
router.get('/dashboard', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 3) return res.status(403).json({ status: 'ERROR', message: 'Acceso solo para socios.' });
    try {
        const idSocio = req.user.id_usuario;

        const hoyStats = pool.query(`
            SELECT COALESCE(SUM(b.monto_pagado_centavos), 0) as ingresos_hoy,
                   COUNT(*) as boletos_hoy
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            JOIN bus ON t.id_bus = bus.id_bus
            WHERE bus.id_socio = $1 AND b.estado_boleto = 'VALIDO' AND DATE(b.fecha_emision) = CURRENT_DATE
        `, [idSocio]);

        const busesActivos = pool.query(`
            SELECT COUNT(DISTINCT t.id_bus) as en_ruta
            FROM turno_viaje t
            JOIN bus ON t.id_bus = bus.id_bus
            WHERE bus.id_socio = $1 AND (t.estado_turno = 'ABIERTO' OR t.estado_turno = 'En Progreso')
        `, [idSocio]);

        const alertasAuditoria = pool.query(`
            SELECT COUNT(*) as total
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            JOIN bus ON t.id_bus = bus.id_bus
            WHERE bus.id_socio = $1 AND (b.alerta_auditoria_qr = true OR b.estado_boleto = 'ANULADO')
        `, [idSocio]);

        const ingresosPorRuta = pool.query(`
            SELECT rm.nombre_modalidad as ruta,
                   COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as total_soles
            FROM ruta_modalidad rm
            LEFT JOIN tarifario t ON rm.id_ruta_modalidad = t.id_ruta_modalidad
            LEFT JOIN boleto b ON t.id_tarifario = b.id_tarifario AND b.estado_boleto = 'VALIDO'
            JOIN turno_viaje tv ON b.id_turno = tv.id_turno
            JOIN bus ON tv.id_bus = bus.id_bus
            WHERE bus.id_socio = $1
            GROUP BY rm.nombre_modalidad
        `, [idSocio]);

        const historicoGlobal = pool.query(`
            SELECT COALESCE(SUM(b.monto_pagado_centavos), 0) as total_historico_centavos,
                   COUNT(*) as total_boletos_historico
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            JOIN bus ON t.id_bus = bus.id_bus
            WHERE bus.id_socio = $1 AND b.estado_boleto = 'VALIDO'
        `, [idSocio]);

        const rutaMasRentable = pool.query(`
            SELECT rm.nombre_modalidad as ruta,
                   COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as rendimiento
            FROM ruta_modalidad rm
            JOIN tarifario t ON rm.id_ruta_modalidad = t.id_ruta_modalidad
            JOIN boleto b ON t.id_tarifario = b.id_tarifario
            JOIN turno_viaje tv ON b.id_turno = tv.id_turno
            JOIN bus ON tv.id_bus = bus.id_bus
            WHERE bus.id_socio = $1 AND b.estado_boleto = 'VALIDO'
            GROUP BY rm.nombre_modalidad
            ORDER BY rendimiento DESC LIMIT 1
        `, [idSocio]);

        const [hStats, bActivos, aAuditoria, iRuta, hGlobal, rRentable] = await Promise.all([
            hoyStats, busesActivos, alertasAuditoria, ingresosPorRuta, historicoGlobal, rutaMasRentable
        ]);

        return res.json({
            status: 'OK',
            data: {
                kpis_hoy: {
                    ingresos_hoy_soles: parseInt(hStats.rows[0].ingresos_hoy, 10) / 100,
                    boletos_hoy: parseInt(hStats.rows[0].boletos_hoy, 10),
                    buses_en_ruta: parseInt(bActivos.rows[0].en_ruta, 10),
                    alertas_mantenimiento: parseInt(aAuditoria.rows[0].total, 10)
                },
                grafico_rutas: iRuta.rows,
                kpis_historicos: {
                    total_recaudado_historico_soles: parseInt(hGlobal.rows[0].total_historico_centavos, 10) / 100,
                    total_boletos_vendidos: parseInt(hGlobal.rows[0].total_boletos_historico, 10),
                    ruta_lider_nombre: rRentable.rows[0] ? rRentable.rows[0].ruta : 'Ninguna registrada',
                    ruta_lider_rendimiento: rRentable.rows[0] ? parseFloat(rRentable.rows[0].rendimiento) : 0
                }
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Fallo al procesar métricas del socio.' });
    }
});

// ========================================================
// LISTAR BUSES DEL SOCIO (GET)
// ========================================================
router.get('/buses', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 3) return res.status(403).json({ status: 'ERROR', message: 'Acceso solo para socios.' });
    try {
        const idSocio = req.user.id_usuario;
        const buses = await pool.query(`
            SELECT b.*, u.nombres as socio_nombres,
                   COALESCE(STRING_AGG(DISTINCT rm.nombre_modalidad, ', ' ORDER BY rm.nombre_modalidad), '') as rutas_ejecutadas
            FROM bus b
            LEFT JOIN usuario u ON b.id_socio = u.id_usuario
            LEFT JOIN turno_viaje t ON b.id_bus = t.id_bus
            LEFT JOIN ruta_modalidad rm ON t.id_ruta_modalidad = rm.id_ruta_modalidad
            WHERE b.id_socio = $1
            GROUP BY b.id_bus, u.nombres
            ORDER BY b.id_bus DESC
        `, [idSocio]);
        return res.json({ status: 'OK', data: buses.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// VENTAS DE UN BUS DEL SOCIO POR PERÍODO (GET)
// ========================================================
router.get('/bus-sales/:busId', authMiddleware, async (req, res) => {
    if (req.user.id_rol !== 3) return res.status(403).json({ status: 'ERROR', message: 'Acceso solo para socios.' });
    try {
        const { busId } = req.params;
        const { from, to } = req.query;
        const idSocio = req.user.id_usuario;

        const busCheck = await pool.query('SELECT id_bus FROM bus WHERE id_bus = $1 AND id_socio = $2', [busId, idSocio]);
        if (busCheck.rows.length === 0) {
            return res.status(404).json({ status: 'ERROR', message: 'Bus no encontrado o no pertenece al socio.' });
        }

        let query = `
            SELECT COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as total_soles,
                   COUNT(*) as total_boletos
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            WHERE t.id_bus = $1 AND b.estado_boleto = 'VALIDO'
        `;
        const params = [busId];

        if (from) {
            query += ` AND b.fecha_emision >= $${params.length + 1}`;
            params.push(from);
        }
        if (to) {
            query += ` AND b.fecha_emision < ($${params.length + 1}::date + interval '1 day')`;
            params.push(to);
        }

        const result = await pool.query(query, params);
        return res.json({ status: 'OK', data: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

module.exports = router;