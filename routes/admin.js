// src/routes/admin.js 
const express = require('express');
const bcrypt = require('bcryptjs'); // Global para evitar caídas de módulo
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../middleware/authMiddleware');

// 1. ENDPOINT ANALÍTICO: KPIs DEL DASHBOARD
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const ingresos = await pool.query("SELECT SUM(monto_pagado_centavos) as total FROM boleto WHERE estado_boleto = 'VALIDO'");
        const emitidos = await pool.query("SELECT COUNT(*) as total FROM boleto WHERE estado_boleto = 'VALIDO'");
        const anulados = await pool.query("SELECT COUNT(*) as total FROM boleto WHERE estado_boleto = 'ANULADO'");
        const fraudes = await pool.query("SELECT COUNT(*) as total FROM boleto WHERE alerta_auditoria_qr = true");

        const alertasRecientes = await pool.query(
    `SELECT b.id_boleto, u.nombres as cobrador, b.monto_pagado_centavos, b.fecha_anulacion 
     FROM boleto b
     JOIN turno_viaje t ON b.id_turno = t.id_turno
     JOIN usuario u ON t.id_usuario_cobrador = u.id_usuario
     WHERE b.alerta_auditoria_qr = true AND b.auditado = false
     ORDER BY b.fecha_emision DESC LIMIT 5`
);

        return res.json({
            status: 'OK',
            kpis: {
                total_recaudado_soles: (ingresos.rows[0].total || 0) / 100,
                boletos_emitidos: parseInt(emitidos.rows[0].total || 0),
                boletos_anulados: parseInt(anulados.rows[0].total || 0),
                fraudes_detectados: parseInt(fraudes.rows[0].total || 0)
            },
            alertas: alertasRecientes.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al generar analíticas gerenciales.' });
    }
});


// 2. MÓDULO DE GESTIÓN: USUARIOS / CONDUCTORES 
router.get('/usuarios', authMiddleware, async (req, res) => {
    try {
        const usuarios = await pool.query(
            `SELECT u.id_usuario, u.dni, u.nombres, u.correo, r.nombre_rol 
             FROM usuario u 
             JOIN rol r ON u.id_rol = r.id_rol ORDER BY u.id_usuario DESC`
        );
        return res.json({ status: 'OK', data: usuarios.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

router.post('/usuarios', authMiddleware, async (req, res) => {
    try {
        const { dni, nombres, correo, password, id_rol } = req.body;
        
        const nombreRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/;
        if (!nombreRegex.test(nombres)) {
            return res.status(400).json({ status: 'ERROR', message: 'El nombre solo debe contener letras.' });
        }
        const correoRegex = /^[^\s@]+@(mala\.com|svdrayf\.com)$/;
        if (!correoRegex.test(correo.toLowerCase())) {
            return res.status(400).json({ status: 'ERROR', message: 'El correo debe pertenecer al dominio @mala.com o @svdrayf.com' });
        }
        // Forzamos base decimal para garantizar consistencia: 4 = Fiscalizador, 5 = Cobrador
        const targetRol = parseInt(id_rol, 10);

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const nuevoUsuario = await pool.query(
            `INSERT INTO usuario (dni, nombres, correo, password_hash, requiere_cambio, id_rol) 
             VALUES ($1, $2, $3, $4, true, $5) RETURNING id_usuario, nombres, correo, id_rol`,
            [dni.trim(), nombres.trim(), correo.trim().toLowerCase(), password_hash, targetRol]
        );

        return res.json({ status: 'OK', message: 'Personal operativo registrado exitosamente.', data: nuevoUsuario.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ status: 'ERROR', message: 'El número de DNI o correo ya pertenecen a otro empleado registrado.' });
        }
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});


// 3. MÓDULO DE GESTIÓN: MAESTRO DE FLOTA / BUSES
router.get('/buses', authMiddleware, async (req, res) => {
    try {
        const buses = await pool.query(
            `SELECT b.*, u.nombres as socio_nombres,
                    COALESCE(
                      (SELECT string_agg(DISTINCT rm.nombre_modalidad, ',') 
                       FROM turno_viaje tv
                       JOIN boleto bol ON tv.id_turno = bol.id_turno
                       JOIN tarifario tar ON bol.id_tarifario = tar.id_tarifario
                       JOIN ruta_modalidad rm ON tar.id_ruta_modalidad = rm.id_ruta_modalidad
                       WHERE tv.id_bus = b.id_bus), 
                      ''
                    ) as rutas_ejecutadas
             FROM bus b 
             LEFT JOIN usuario u ON b.id_socio = u.id_usuario 
             ORDER BY b.id_bus DESC`
        );
        return res.json({ status: 'OK', data: buses.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// 4. CONFIGURACIÓN DE DATOS DEL TICKET TÉRMICO (RF14)
// ========================================================
router.get('/configuracion', authMiddleware, async (req, res) => {
    try {
        const config = await pool.query('SELECT * FROM configuracion_empresa WHERE id_config = 1');
        return res.json({ status: 'OK', data: config.rows[0] || null });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al recuperar la configuración del ticket.' });
    }
});

router.put('/configuracion', authMiddleware, async (req, res) => {
    try {
        const { razon_social, ruc, direccion_fiscal, leyenda_pie } = req.body;
        const config = await pool.query(
            `UPDATE configuracion_empresa 
             SET razon_social = $1, ruc = $2, direccion_fiscal = $3, leyenda_pie = $4 
             WHERE id_config = 1 RETURNING *`,
            [razon_social, ruc, direccion_fiscal, leyenda_pie]
        );
        return res.json({ status: 'OK', message: 'Datos del ticket actualizados', data: config.rows[0] });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// 5. MATRIZ DE PERMISOS Y ROLES (RF02)
// ========================================================
router.get('/permisos/matriz', authMiddleware, async (req, res) => {
    try {
        const roles = await pool.query('SELECT id_rol, nombre_rol FROM rol ORDER BY id_rol ASC');
        const permisos = await pool.query('SELECT id_permiso, nombre_modulo, clave_acceso FROM permiso ORDER BY id_permiso ASC');
        const cruces = await pool.query('SELECT id_rol, id_permiso FROM rol_permiso');

        return res.json({
            status: 'OK',
            data: {
                roles: roles.rows,
                permisos: permisos.rows,
                asignaciones: cruces.rows 
            }
        });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// 6. MÉTRICAS RELACIONALES GLOBALES (AdminDashboard.tsx)
// ========================================================
// Se extrajo del anidamiento y se protegió con authMiddleware conforme a la arquitectura SVDRAYF
router.get('/dashboard-stats', authMiddleware, async (req, res) => {
    try {
        const usuariosCount = pool.query('SELECT COUNT(*) FROM usuario');
        const busesCount = pool.query('SELECT COUNT(*) FROM bus');
        const tarifasCount = pool.query('SELECT COUNT(*) FROM "tarifario"'); // Comillas dobles por si el identificador es reservado

        const [uRes, bRes, tRes] = await Promise.all([usuariosCount, busesCount, tarifasCount]);

        return res.json({
            status: 'OK',
            data: {
                total_usuarios: parseInt(uRes.rows[0].count, 10),
                total_buses: parseInt(bRes.rows[0].count, 10),
                total_tarifas: parseInt(tRes.rows[0].count, 10)
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: 'Error al compilar métricas relacionales.' });
    }
});

// ========================================================
// MAESTRO DE FLOTA: LEER TODAS LAS UNIDADES + JOIN SOCIO
// ========================================================
router.get('/buses', authMiddleware, async (req, res) => {
    try {
        const buses = await pool.query(
            `SELECT b.*, u.nombres as socio_nombres 
             FROM bus b 
             LEFT JOIN usuario u ON b.id_socio = u.id_usuario 
             ORDER BY b.id_bus DESC`
        );
        return res.json({ status: 'OK', data: buses.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// ASISTENTE DE DIALOG: BUSCAR SÓLO USUARIOS CON ROL SOCIO
// ========================================================
router.get('/socios-list', authMiddleware, async (req, res) => {
    try {
        // Filtra los usuarios cuyo id_rol es 3 (Socio Copropietario)
        const socios = await pool.query(
            'SELECT id_usuario, nombres, dni FROM usuario WHERE id_rol = 3 ORDER BY nombres ASC'
        );
        return res.json({ status: 'OK', data: socios.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ========================================================
// REGISTRAR AUTOBÚS CON VALIDACIÓN PERIMETRAL (CUS-03)
// ========================================================
router.post('/buses', authMiddleware, async (req, res) => {
    try {
        const { 
            placa, numero_padron, marca, modelo, anio_modelo, 
            chasis_numero, kilometraje_inicial, tipo_combustible, 
            capacidad_pasajeros, id_socio 
        } = req.body;
        
        const nuevoBus = await pool.query(
            `INSERT INTO bus (placa, numero_padron, marca, modelo, anio_modelo, chasis_numero, kilometraje_inicial, tipo_combustible, capacidad_pasajeros, id_socio, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING *`,
            [
                placa.trim().toUpperCase(), numero_padron.trim(), marca.trim(), 
                modelo.trim(), parseInt(anio_modelo, 10), chasis_numero.trim(), 
                parseInt(kilometraje_inicial, 10), tipo_combustible, 
                parseInt(capacidad_pasajeros, 10), id_socio ? parseInt(id_socio, 10) : null
            ]
        );
        return res.json({ status: 'OK', message: 'Unidad vehicular registrada', data: nuevoBus.rows[0] });
    } catch (err) {
        //  CAPTURA FILTRO PASO 5 NEON DB: Si el trigger detecta que el id_socio asignado NO tiene rol 3, frena el insert
        if (err.code === 'P0001') {
            return res.status(400).json({ status: 'ERROR', message: err.message });
        }
        if (err.code === '23505') {
            return res.status(409).json({ status: 'ERROR', message: 'Clave duplicada: La placa, número de padrón o chasis ya se encuentran registrados en la flota.' });
        }
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

// ========================================================
// MODIFICAR VEHÍCULO (EDICIÓN RESTRINGIDA A PARÁMETROS)
// ========================================================
router.put('/buses/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { capacidad_pasajeros, id_socio, modelo, anio_modelo } = req.body;

        await pool.query(
            `UPDATE bus 
             SET capacidad_pasajeros = $1, id_socio = $2, modelo = $3, anio_modelo = $4 
             WHERE id_bus = $5`,
            [parseInt(capacidad_pasajeros, 10), id_socio ? parseInt(id_socio, 10) : null, modelo, parseInt(anio_modelo, 10), id]
        );

        return res.json({ status: 'OK', message: 'Unidad vehicular modificada exitosamente.' });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});


// DAR DE BAJA LÓGICA (MODIFICACIÓN DE FLAG DE ESTADO)
router.delete('/buses/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE bus SET estado = false WHERE id_bus = $1', [id]);
        return res.json({ status: 'OK', message: 'Unidad dada de baja en el sistema.' });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

router.get('/tarifarios', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, 
                   po.nombre_paradero as origen_nombre, 
                   pd.nombre_paradero as destino_nombre, 
                   tp.nombre_tipo as pasajero_tipo_nombre,
                   rm.nombre_modalidad as modalidad_nombre
            FROM tarifario t
            LEFT JOIN paradero po ON t.id_paradero_origen = po.id_paradero
            LEFT JOIN paradero pd ON t.id_paradero_destino = pd.id_paradero
            LEFT JOIN tipo_pasajero tp ON t.id_tipo_pasajero = tp.id_tipo_pasajero
            LEFT JOIN ruta_modalidad rm ON t.id_ruta_modalidad = rm.id_ruta_modalidad
            ORDER BY t.id_tarifario DESC
        `);
        return res.json({ status: 'OK', data: result.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// AUXILIAR: Cargar dependencias para poblar los selectores del Dialog modal
router.get('/tarifarios-dependencies', authMiddleware, async (req, res) => {
    try {
        const paraderos = pool.query('SELECT id_paradero, nombre_paradero FROM paradero WHERE estado = true ORDER BY nombre_paradero ASC');
        const pasajeros = pool.query('SELECT id_tipo_pasajero, nombre_tipo FROM tipo_pasajero ORDER BY id_tipo_pasajero ASC');
        const modalidades = pool.query('SELECT id_ruta_modalidad, nombre_modalidad FROM ruta_modalidad ORDER BY id_ruta_modalidad ASC');

        const [pRes, pasRes, mRes] = await Promise.all([paraderos, pasajeros, modalidades]);
        return res.json({
            status: 'OK',
            data: { paraderos: pRes.rows, tipos_pasajero: pasRes.rows, modalidades: mRes.rows }
        });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// CREATE: Insertar un tramo con ambas tarifas indexadas
router.post('/tarifarios', authMiddleware, async (req, res) => {
    try {
        const { id_ruta_modalidad, id_paradero_origen, id_paradero_destino, id_tipo_pasajero, precio_normal, precio_dom_fer } = req.body;
        await pool.query(`
            INSERT INTO tarifario (id_ruta_modalidad, id_paradero_origen, id_paradero_destino, id_tipo_pasajero, precio_normal_centavos, precio_dom_fer_centavos)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [id_ruta_modalidad, id_paradero_origen, id_paradero_destino, id_tipo_pasajero, precio_normal * 100, precio_dom_fer * 100]
        );
        return res.json({ status: 'OK', message: 'Tarifario indexado exitosamente en Soles.' });
    } catch (err) {
        // CAPTURA FILTRO PASO 3 NEON DB: Atrapa inconsistencias geográficas u homónimos de tramos
        if (err.code === '23514') {
            return res.status(400).json({ status: 'ERROR', message: 'Inconsistencia Geográfica: El paradero de origen no puede ser idéntico al paradero de destino para la ruta Mala-Lima.' });
        }
        if (err.code === '23505') {
            return res.status(409).json({ status: 'ERROR', message: 'Redundancia Contable: Ya existe un tarifario parametrizado para esa ruta, paraderos y tipo de pasajero.' });
        }
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// UPDATE: Modificar montos por regulaciones de combustible
router.put('/tarifarios/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { precio_normal, precio_dom_fer } = req.body;
        await pool.query(
            'UPDATE tarifario SET precio_normal_centavos = $1, precio_dom_fer_centavos = $2 WHERE id_tarifario = $3',
            [precio_normal * 100, precio_dom_fer * 100, id]
        );
        return res.json({ status: 'OK', message: 'Matriz de precios modificada.' });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});


// GESTIÓN DE ACCESOS: LEER SOLICITUDES ACTIVAS
router.get('/recuperaciones', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT tr.id_token, tr.id_usuario, tr.fecha_creacion, tr.fecha_expiracion,
                   u.nombres as usuario_nombres, u.correo as usuario_correo, u.dni as usuario_dni, u.id_rol
            FROM token_recuperacion tr
            JOIN usuario u ON tr.id_usuario = u.id_usuario
            WHERE tr.usado = false
            ORDER BY tr.fecha_creacion DESC
        `);
        return res.json({ status: 'OK', data: result.rows });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ACCIÓN A: GENERAR CONTRASEÑA TEMPORAL CRIPTOGRÁFICA
router.post('/recuperaciones/generar/:id_token', authMiddleware, async (req, res) => {
    try {
        const { id_token } = req.params;

        // Verificar validez de la solicitud
        const tokenCheck = await pool.query('SELECT id_usuario FROM token_recuperacion WHERE id_token = $1 AND usado = false', [id_token]);
        if (tokenCheck.rows.length === 0) {
            return res.status(400).json({ status: 'ERROR', error: 'La solicitud ya fue procesada o expiró.' });
        }
        const id_usuario = tokenCheck.rows[0].id_usuario;

        // Generar PIN legible en texto plano
        const claveTemporalClaro = 'SVD-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Cifrar la credencial para guardarla en la base de datos
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(claveTemporalClaro, salt);

        // Bloque transaccional atómico
        await pool.query('BEGIN');
        
        // Actualizar tabla usuario exigiendo el flag de cambio mandatorio
        await pool.query(
            'UPDATE usuario SET password_hash = $1, requiere_cambio = true WHERE id_usuario = $2',
            [password_hash, id_usuario]
        );
        
        // Marcar la solicitud como atendida (Quema el token)
        await pool.query('UPDATE token_recuperacion SET usado = true WHERE id_token = $1', [id_token]);
        
        await pool.query('COMMIT');

        // Retorna el PIN limpio exclusivamente al Administrador
        return res.json({ 
            status: 'OK', 
            message: 'Clave temporal generada con éxito.',
            clave_temporal: claveTemporalClaro 
        });
    } catch (err) {
        await pool.query('ROLLBACK');
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// ACCIÓN B: ANULAR SOLICITUD MANUALMENTE (FACTOR PERSONA)
router.post('/recuperaciones/anular/:id_token', authMiddleware, async (req, res) => {
    try {
        const { id_token } = req.params;
        // Se marca como usado para archivar la solicitud sin alterar las credenciales vigentes del usuario
        await pool.query('UPDATE token_recuperacion SET usado = true WHERE id_token = $1', [id_token]);
        return res.json({ status: 'OK', message: 'Solicitud cancelada. El operador mantiene sus accesos intactos.' });
    } catch (err) {
        return res.status(500).json({ status: 'ERROR', error: err.message });
    }
});

// DASHBOARD EJECUTIVO PARA GERENCIA (dashboard-exec)
router.get('/dashboard-exec', authMiddleware, async (req, res) => {
    try {
        const hoyStats = pool.query(`
            SELECT COALESCE(SUM(monto_pagado_centavos), 0) as ingresos_hoy,
                   COUNT(*) as boletos_hoy
            FROM boleto 
            WHERE estado_boleto = 'VALIDO' 
              AND (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date
        `);

        const busesActivos = pool.query(`
            SELECT COUNT(DISTINCT id_bus) as en_ruta 
            FROM turno_viaje 
            WHERE UPPER(estado_turno) IN ('ABIERTO', 'EN PROGRESO')
              AND (fecha_apertura AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date
        `);
        const alertasAuditoria = pool.query(`
    SELECT COUNT(*) as total FROM boleto WHERE alerta_auditoria_qr = true AND auditado = false
`);

        const ingresosPorRuta = pool.query(`
            SELECT rm.nombre_modalidad as ruta, 
                   COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as total_soles
            FROM ruta_modalidad rm
            LEFT JOIN tarifario t ON rm.id_ruta_modalidad = t.id_ruta_modalidad
            LEFT JOIN boleto b ON t.id_tarifario = b.id_tarifario AND b.estado_boleto = 'VALIDO'
            GROUP BY rm.nombre_modalidad
        `);

        const historicoGlobal = pool.query(`
            SELECT COALESCE(SUM(monto_pagado_centavos), 0) as total_historico_centavos,
                   COUNT(*) as total_boletos_historico
            FROM boleto 
            WHERE estado_boleto = 'VALIDO'
        `);

        const rutaMasRentable = pool.query(`
            SELECT rm.nombre_modalidad as ruta, 
                   COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as rendimiento
            FROM ruta_modalidad rm
            JOIN tarifario t ON rm.id_ruta_modalidad = t.id_ruta_modalidad
            JOIN boleto b ON t.id_tarifario = b.id_tarifario
            WHERE b.estado_boleto = 'VALIDO'
            GROUP BY rm.nombre_modalidad
            ORDER BY rendimiento DESC LIMIT 1
        `);

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
        return res.status(500).json({ status: 'ERROR', message: 'Fallo al procesar métricas gerenciales.' });
    }
});


// ANULACION DE BOLETO
router.post('/anulacion-boleto', authMiddleware, async (req, res) => {
    try {
        const { id_boleto, id_motivo } = req.body;

        // 1. Insertar en la tabla de anulaciones
        await pool.query(
            `INSERT INTO anulacion_boleto (id_boleto, id_motivo) VALUES ($1, $2)`,
            [id_boleto, id_motivo]
        );

        // 2. Actualizar el estado del boleto a 'ANULADO'
        await pool.query(
            `UPDATE boleto SET estado_boleto = 'ANULADO' WHERE id_boleto = $1`,
            [id_boleto]
        );

        return res.json({ status: 'OK', message: 'Boleto anulado exitosamente.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

// REGISTRAR INCIDENCIA (POST)
router.post('/incidencias', authMiddleware, async (req, res) => {
    try {
        const { id_turno, id_boleto, tipo_incidencia, descripcion } = req.body;

        await pool.query(
            `INSERT INTO incidencias (id_turno, id_boleto, tipo_incidencia, descripcion)
             VALUES ($1, $2, $3, $4)`,
            [id_turno, id_boleto, tipo_incidencia, descripcion]
        );

        // Si la incidencia es de tipo fraude o similar, marcamos el boleto
        if (tipo_incidencia === 'FRAUDE_QR' || tipo_incidencia === 'ANULACION_INDEBIDA') {
            await pool.query(
                `UPDATE boleto SET alerta_auditoria_qr = true WHERE id_boleto = $1`,
                [id_boleto]
            );
        }

        return res.json({ status: 'OK', message: 'Incidencia registrada.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});



// LISTAR RUTAS/MODALIDADES PARA FILTROS (GET)
router.get('/rutas-modalidad', authMiddleware, async (req, res) => {
    try {
        const rutas = await pool.query(
            'SELECT id_ruta_modalidad, nombre_modalidad FROM ruta_modalidad ORDER BY nombre_modalidad'
        );
        return res.json({ status: 'OK', data: rutas.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});


// VENTAS DE UN BUS POR PERÍODO (GET)
router.get('/bus-sales/:busId', authMiddleware, async (req, res) => {
    try {
        const { busId } = req.params;
        const { from, to } = req.query;

        let query = `
            SELECT 
                COALESCE(SUM(b.monto_pagado_centavos), 0) / 100.0 as total_soles,
                COUNT(*) as total_boletos
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            WHERE t.id_bus = $1 AND b.estado_boleto = 'VALIDO'
        `;
        const params = [busId];   // ← sin tipo

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

// LISTAR BOLETOS ANULADOS CON DETALLES (GET)
router.get('/boletos-anulados', authMiddleware, async (req, res) => {
    try {
        const { desde, hasta, placa, motivo } = req.query;

        let query = `
            SELECT 
                b.id_boleto,
                b.fecha_emision,
                b.monto_pagado_centavos,
                b.modalidad_pago,
                b.auditado,
                COALESCE(ma.descripcion_motivo, 'Sin motivo') as motivo,
                u.nombres as cobrador,
                t.id_bus,
                bus.placa,
                bus.numero_padron
            FROM boleto b
            LEFT JOIN anulacion_boleto ab ON b.id_boleto = ab.id_boleto
            LEFT JOIN motivo_anulacion ma ON ab.id_motivo = ma.id_motivo
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            JOIN usuario u ON t.id_usuario_cobrador = u.id_usuario
            JOIN bus ON t.id_bus = bus.id_bus
            WHERE b.estado_boleto = 'ANULADO'
        `;

        const params = [];
const conditions = [];

        if (desde) {
            params.push(desde);
            conditions.push(`b.fecha_emision >= $${params.length}`);
        }
        if (hasta) {
            params.push(hasta);
            conditions.push(`b.fecha_emision < ($${params.length}::date + interval '1 day')`);
        }
        if (placa) {
            params.push(`%${placa}%`);
            conditions.push(`bus.placa ILIKE $${params.length}`);
        }
        if (motivo) {
            params.push(`%${motivo}%`);
            conditions.push(`ma.descripcion_motivo ILIKE $${params.length}`);
        }

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' ORDER BY b.fecha_emision DESC';

        const result = await pool.query(query, params);
        return res.json({ status: 'OK', data: result.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});


// MARCAR BOLETO ANULADO COMO AUDITADO (PUT) - CORREGIDO
router.put('/boletos-anulados/:id_boleto/auditar', authMiddleware, async (req, res) => {
    try {
        const { id_boleto } = req.params;

       await pool.query(
    `UPDATE boleto 
     SET auditado = true 
     WHERE id_boleto = $1 AND estado_boleto = 'ANULADO'`,
    [id_boleto]
);

        return res.json({ 
            status: 'OK', 
            message: 'Boleto marcado como auditado correctamente. Alerta removida del panel de control.' 
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});


// BUSCAR BOLETOS POR HASH QR O COBRADOR (GET)
router.get('/buscar-boletos', authMiddleware, async (req, res) => {
    try {
        const { hash, cobrador } = req.query;
        let query = `
            SELECT 
                b.id_boleto,
                b.hash_qr,
                b.estado_boleto,
                b.monto_pagado_centavos,
                b.fecha_emision,
                b.modalidad_pago,
                u.nombres as cobrador,
                bus.placa,
                bus.numero_padron,
                rm.nombre_modalidad as ruta,
                po.nombre_paradero as origen,
                pd.nombre_paradero as destino
            FROM boleto b
            JOIN turno_viaje t ON b.id_turno = t.id_turno
            JOIN usuario u ON t.id_usuario_cobrador = u.id_usuario
            JOIN bus ON t.id_bus = bus.id_bus
            JOIN ruta_modalidad rm ON t.id_ruta_modalidad = rm.id_ruta_modalidad
            LEFT JOIN tarifario tf ON b.id_tarifario = tf.id_tarifario
            LEFT JOIN paradero po ON tf.id_paradero_origen = po.id_paradero
            LEFT JOIN paradero pd ON tf.id_paradero_destino = pd.id_paradero
        `;

        const params = [];
        if (hash) {
            params.push(hash);
            query += ` WHERE b.hash_qr = $${params.length}`;
        } else if (cobrador) {
            params.push(`%${cobrador}%`);
            query += ` WHERE u.nombres ILIKE $${params.length}`;
        } else {
            return res.status(400).json({ status: 'ERROR', message: 'Debe proporcionar un parámetro de búsqueda.' });
        }

        query += ` ORDER BY b.fecha_emision DESC LIMIT 50`;
        const result = await pool.query(query, params);
        return res.json({ status: 'OK', data: result.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'ERROR', message: err.message });
    }
});
module.exports = router;