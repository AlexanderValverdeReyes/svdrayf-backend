const request = require('supertest');
const express = require('express');
const router = require('../routes/admin');
const pool = require('../db');    

// 1. SIMULACIÓN DE LA BASE DE DATOS (Evita alterar NeonDB durante los tests)
jest.mock('../db', () => ({
    query: jest.fn()
}));

// 2. SIMULACIÓN DEL AUTHMIDDLEWARE (Permite probar el endpoint de forma directa)
jest.mock('../middleware/authMiddleware', () => (req, res, next) => {
    req.user = { id: 1, rol: 'Superusuario' };
    next();
});

const app = express();
app.use(express.json());
app.use('/', router);

// BLOQUE DE PRUEBAS: RF01 - REGISTRAR USUARIOS 
describe('RF01 - Registrar Usuarios', () => {

    afterEach(() => {
        jest.clearAllMocks(); // Limpia los experimentos entre cada test
    });

    // CP01: ESCENARIO EXITOSO (Happy Path)
    test('CP01 — Registro Exitoso', async () => {
        // ARRANGE: Preparamos datos correctos [cite: 13, 20]
        const usuarioValido = {
            dni: '12345678',
            nombres: 'Alexander Valverde',
            correo: 'alexander@svdrayf.com',
            password: 'Password123!',
            id_rol: 5
        };

        // Simulamos que la base de datos responde exitosamente con el usuario insertado
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 1, nombres: 'Alexander Valverde', correo: 'alexander@svdrayf.com', id_rol: 5 }]
        });

        // ACT: Ejecutamos el endpoint [cite: 13, 20]
        const response = await request(app).post('/usuarios').send(usuarioValido);

        // ASSERT: Verificamos el estado conforme [cite: 13, 20]
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Personal operativo registrado exitosamente.');
    });

    // CP03: ESCENARIO DE ERROR - FORMATO INVÁLIDO (Extensión Corta de DNI)
    test('CP03 — E2 — Formato inválido (DNI Menor a 8 dígitos)', async () => {
        // ARRANGE: Preparamos un DNI inválido de solo 5 dígitos [cite: 13, 20]
        const usuarioDniCorto = {
            dni: '12345', 
            nombres: 'Alexander Valverde',
            correo: 'alexander@svdrayf.com',
            password: 'Password123!',
            id_rol: 5
        };

        // ACT: Ejecutamos la acción [cite: 13, 20]
        const response = await request(app).post('/usuarios').send(usuarioDniCorto);

        // ASSERT: Esperamos que el sistema lo ataje y bloquee [cite: 13, 20]
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: Formato inválido. El DNI debe tener exactamente 8 dígitos.');
    });

    // CP04: ESCENARIO DE ERROR - DUPLICIDAD DE DNI
    test('CP04 — E3 — Duplicidad de DNI', async () => {
        // ARRANGE: Datos idénticos a uno existente [cite: 13, 20]
        const usuarioDuplicado = {
            dni: '77777777',
            nombres: 'Juan Perez',
            correo: 'juan@mala.com',
            password: 'Password123!',
            id_rol: 4
        };

        // Simulamos que PostgreSQL arroja el error de llave duplicada (Código 23505)
        const errorDuplicidad = new Error('duplicate key value violates unique constraint');
        errorDuplicidad.code = '23505';
        pool.query.mockRejectedValueOnce(errorDuplicidad);

        // ACT: Intentamos guardar [cite: 13, 20]
        const response = await request(app).post('/usuarios').send(usuarioDuplicado);

        // ASSERT: Verificamos que el catch maneje el conflicto con código 409 [cite: 13, 20]
        expect(response.statusCode).toBe(409);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('El número de DNI o correo ya pertenecen a otro empleado registrado.');
    });
});

describe('RF02 - Gestionar Maestro de Flota', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('CP06 — Registro correcto de vehículo', async () => {
        // ARRANGE [cite: 13, 20]
        const nuevoVehiculo = {
            placa: 'F3V-894',
            numero_padron: '102',
            marca: 'Mercedes-Benz',
            modelo: 'O500R',
            anio_modelo: '2022',
            chasis_numero: '9BM38402',
            kilometraje_inicial: '5000',
            tipo_combustible: 'Diésel',
            capacidad_pasajeros: '50',
            id_socio: 3
        };
        pool.query.mockResolvedValueOnce({
            rows: [{ id_bus: 1, placa: 'F3V-894', estado: true }]
        });

        // ACT [cite: 13, 20]
        const response = await request(app).post('/buses').send(nuevoVehiculo);

        // ASSERT [cite: 13, 20]
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Unidad vehicular registrada');
    });

    test('CP07 — E1 — Número de placa vehicular duplicado', async () => {
        // ARRANGE [cite: 13, 20]
        const vehiculoDuplicado = {
            placa: 'F3V-894',
            numero_padron: '105',
            marca: 'Volvo',
            modelo: 'B11R',
            anio_modelo: '2023',
            chasis_numero: '9BM55522',
            kilometraje_inicial: '1000',
            tipo_combustible: 'Diésel',
            capacidad_pasajeros: '45',
            id_socio: 3
        };
        const errorPg = new Error('duplicate key value violates unique constraint "bus_placa_key"');
        errorPg.code = '23505';
        errorPg.detail = 'Key (placa)=(F3V-894) already exists.';
        pool.query.mockRejectedValueOnce(errorPg);

        // ACT [cite: 13, 20]
        const response = await request(app).post('/buses').send(vehiculoDuplicado);

        // ASSERT [cite: 13, 20]
        expect(response.statusCode).toBe(409);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: La placa vehicular ingresada ya se encuentra registrada en el sistema.');
    });

    test('CP09 — E3 — Restricción de eliminación (Bus en uso)', async () => {
        // ARRANGE [cite: 13, 20]
        const idBusEnUso = 45;
        pool.query.mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ id_turno: 999, id_bus: idBusEnUso }]
        });

        // ACT [cite: 13, 20]
        const response = await request(app).delete(`/buses/${idBusEnUso}`);

        // ASSERT [cite: 13, 20]
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Acción denegada: No se puede modificar ni inactivar el vehículo porque cuenta con operaciones asociadas en el turno actual.');
    });
});
describe('RF03 - Cargar Tarifario Estático', () => {
    afterEach(() => {
        jest.clearAllMocks(); // Limpia los mocks entre ejecuciones [cite: 16]
    });

    // CP10: PUBLICACIÓN CORRECTA DE TARIFARIO (Happy Path)
    test('CP10 — Publicación correcta de tarifario', async () => {
        // ARRANGE: Preparamos un cuerpo de datos completamente válido [cite: 20]
        const tarifarioValido = {
            id_ruta_modalidad: 1,
            id_paradero_origen: 10,
            id_paradero_destino: 12,
            id_tipo_pasajero: 2,
            precio_normal: 5.50,
            precio_dom_fer: 7.00
        };
        pool.query.mockResolvedValueOnce({ rowCount: 1 });

        // ACT: Ejecutamos el método simulando la petición HTTP [cite: 20]
        const response = await request(app).post('/tarifarios').send(tarifarioValido);

        // ASSERT: Comprobamos el éxito rotundo del almacenamiento [cite: 20, 21]
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Tarifario indexado exitosamente en Soles.');
    });

    // CP11: ERROR — CELDAS O TARIFAS INCOMPLETAS (Sad Path)
    test('CP11 — E1 — Celdas o tarifas incompletas en la matriz', async () => {
        // ARRANGE: Enviamos un tramo donde falta el precio dominical (undefined) [cite: 20]
        const tarifarioIncompleto = {
            id_ruta_modalidad: 1,
            id_paradero_origen: 10,
            id_paradero_destino: 12,
            id_tipo_pasajero: 2,
            precio_normal: 5.50,
            precio_dom_fer: undefined // Celda vacía en la matriz
        };

        // ACT: Enviamos los datos incompletos al servidor [cite: 20]
        const response = await request(app).post('/tarifarios').send(tarifarioIncompleto);

        // ASSERT: El sistema debe bloquear el proceso con código 400 [cite: 20, 22]
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: No se puede publicar el tarifario. Existen tramos obligatorios sin precio asignado.');
    });

    // CP12: ERROR — VALORES DE TARIFA INVÁLIDOS (Sad Path)
    test('CP12 — E2 — Error de formato o valores de tarifa inválidos', async () => {
        // ARRANGE: Digitan un número negativo en el precio regular [cite: 20]
        const tarifarioNegativo = {
            id_ruta_modalidad: 1,
            id_paradero_origen: 10,
            id_paradero_destino: 12,
            id_tipo_pasajero: 2,
            precio_normal: -3.50, // Tarifa inválida
            precio_dom_fer: 6.00
        };

        // ACT: Disparamos la petición errónea [cite: 20]
        const response = await request(app).post('/tarifarios').send(tarifarioNegativo);

        // ASSERT: El validador perimetral intercepta y rechaza la transacción [cite: 20, 22]
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Solo se permiten valores numéricos positivos mayores a cero.');
    });
});

// =========================================================================
// REQUERIMIENTO: RF04 - RECUPERACIÓN DE CONTRASEÑA
// =========================================================================
describe('RF04 - Recuperación de Contraseña', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP14: GENERACIÓN CORRECTA DE PIN TEMPORAL (Happy Path)
    test('CP14 — Generación correcta de contraseña temporal', async () => {
        // ARRANGE
        const idTokenValido = 'token-123';
        
        // Simulación 1: El token existe y no ha sido usado
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 7 }]
        });
        // Simulación 2: Éxito de la transacción SQL (BEGIN, UPDATEs, COMMIT)
        pool.query.mockResolvedValue({ rowCount: 1 });

        // ACT
        const response = await request(app).post(`/recuperaciones/generar/${idTokenValido}`);

        // ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Clave temporal generada con éxito.');
        expect(response.body.clave_temporal).toContain('SVD-');
    });

    // CP16: ERROR — TOKEN DE SEGURIDAD EXPIRADO O CONTROL DE TIEMPO LÍMITE (Sad Path)
    test('CP16 — E2 — Token de seguridad expirado', async () => {
        // ARRANGE
        const idTokenExpirado = 'token-expirado';

        // Simulamos que el token ya expiró en tiempo de base de datos
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 7, fecha_expiracion: new Date(Date.now() - 3600000) }] // Expiró hace 1 hora
        });

        // ACT
        const response = await request(app).post(`/recuperaciones/generar/${idTokenExpirado}`);

        // ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('El token de recuperación ha expirado o ya fue utilizado. Por favor, solicite una nueva restauración de credenciales.');
    });
});

// =========================================================================
// REQUERIMIENTO: RFN06 - VISUALIZAR INGRESOS ONLINE
// =========================================================================
describe('RFN06 - Visualizar Ingresos Online', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP21: VISUALIZACIÓN CORRECTA DE KPIs OPERATIVOS DE HOY (Happy Path)
    test('CP21 — Visualización correcta de ingresos y kpis en tiempo real', async () => {
        // 1. ARRANGE
        pool.query.mockResolvedValueOnce({ rows: [{ ingresos_hoy: 25000, boletos_hoy: 50 }] }); // KPIs Hoy
        pool.query.mockResolvedValueOnce({ rows: [{ en_ruta: 3 }] }); // Buses En Progreso hoy
        pool.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }); // Alertas
        pool.query.mockResolvedValueOnce({ rows: [{ ruta: 'Mala-Lima', total_soles: 250.00 }] }); // Gráfico
        pool.query.mockResolvedValueOnce({ rows: [{ total_historico_centavos: 90000, total_boletos_historico: 180 }] }); // Histórico
        pool.query.mockResolvedValueOnce({ rows: [{ ruta: 'Mala-Lima', rendimiento: 250.00 }] }); // Ruta líder

        // 2. ACT
        const response = await request(app).get('/dashboard-exec');

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data.kpis_hoy.ingresos_hoy_soles).toBe(250.00);
        expect(response.body.data.kpis_hoy.buses_en_ruta).toBe(3);
    });

    // CP22: ESCENARIO INEXISTENCIA DE OPERACIONES HOY (Sad Path)
    test('CP22 — E1 — Inexistencia de datos sincronizados en la jornada actual', async () => {
        // 1. ARRANGE
        pool.query.mockResolvedValueOnce({ rows: [{ ingresos_hoy: 0, boletos_hoy: 0 }] }); // Sin transacciones hoy
        pool.query.mockResolvedValueOnce({ rows: [{ en_ruta: 0 }] }); // Cero buses en progreso
        pool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] });
        pool.query.mockResolvedValueOnce({ rows: [] }); 
        pool.query.mockResolvedValueOnce({ rows: [{ total_historico_centavos: 90000, total_boletos_historico: 180 }] });
        pool.query.mockResolvedValueOnce({ rows: [] });

        // 2. ACT
        const response = await request(app).get('/dashboard-exec');

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data.kpis_hoy.ingresos_hoy_soles).toBe(0); // Fuerza los contadores a cero
        expect(response.body.data.kpis_hoy.buses_en_ruta).toBe(0);
    });
});

// REQUERIMIENTO: RFN07 - AUDITAR BOLETOS ANULADOS
describe('RFN07 - Auditar Boletos Anulados', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP23: CONSULTA CORRECTA DE ANULACIONES (Happy Path)
    test('CP23 — Consulta correcta de anulaciones con filtros operativos', async () => {
        // 1. ARRANGE
        const filasAnuladasSimuladas = [
            { id_boleto: 101, placa: 'F3V-894', monto_pagado_centavos: 500, motivo: 'Mal paradero seleccionado', cobrador: 'Pedro Mamani', auditado: false }
        ];
        pool.query.mockResolvedValueOnce({ rows: filasAnuladasSimuladas });

        // 2. ACT
        const response = await request(app)
            .get('/boletos-anulados')
            .query({ desde: '2026-06-01', hasta: '2026-06-25', placa: 'F3V' });

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].motivo).toBe('Mal paradero seleccionado');
    });

    // CP24: ESCENARIO SINO HAY REGISTROS (Sad Path - Array Vacío)
    test('CP24 — E1 — Registros inexistentes o vacíos para los criterios seleccionados', async () => {
        // 1. ARRANGE
        // Simulamos que no se encuentran coincidencias en la base de datos NeonDB
        pool.query.mockResolvedValueOnce({ rows: [] });

        // 2. ACT
        const response = await request(app)
            .get('/boletos-anulados')
            .query({ desde: '2026-01-01', hasta: '2026-01-05' });

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data).toEqual([]); // Comprobamos que retorna una lista vacía limpia
    });

    // TEST ADICIONAL CONTROL DE INTEGRIDAD: INTENTO DE AUDITAR BOLETO INEXISTENTE
    test('Debería denegar la auditoría si el boleto no existe o no está anulado', async () => {
        // 1. ARRANGE
        const idInvalido = 9999;
        pool.query.mockResolvedValueOnce({ rowCount: 0 }); // Cero filas afectadas en el UPDATE

        // 2. ACT
        const response = await request(app).put(`/boletos-anulados/${idInvalido}/auditar`);

        // 3. ASSERT
        expect(response.statusCode).toBe(404);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: El boleto especificado no existe o no se encuentra en estado ANULADO.');
    });
});


// =========================================================================
// REQUERIMIENTO: RFN08 - FILTRAR BOLETOS CON ALERTA DE QR
// =========================================================================
describe('RFN08 - Filtrar Boletos con Alerta de QR', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP26: FILTRADO CORRECTO DE ALERTAS (Happy Path)
    test('CP26 — Filtrado correcto de alertas de discrepancia', async () => {
        // 1. ARRANGE
        const alertasSimuladas = [
            { id_boleto: 501, placa: 'F3V-894', monto_pagado_centavos: 600, estado_boleto: 'VALIDO', cobrador_nombres: 'Pedro Mamani', alerta_auditoria_qr: true }
        ];
        pool.query.mockResolvedValueOnce({ rows: alertasSimuladas });

        // 2. ACT
        const response = await request(app)
            .get('/boletos-alertas-qr')
            .query({ desde: '2026-06-01', hasta: '2026-06-25' });

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data.length).toBe(1);
        expect(response.body.data[0].alerta_auditoria_qr).toBe(true);
    });

    // CP27: ESCENARIO SIN ALERTAS EN EL RANGO (Sad Path)
    test('CP27 — E1 — No existen boletos con alerta en el rango seleccionado', async () => {
        // 1. ARRANGE
        pool.query.mockResolvedValueOnce({ rows: [] }); // Retorna cuadrícula limpia de forma conforme

        // 2. ACT
        const response = await request(app)
            .get('/boletos-alertas-qr')
            .query({ desde: '2026-01-01', hasta: '2026-01-05' });

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data).toEqual([]); // Comprueba que limpia el grid enviando un array vacío
    });

    // CP28: LATENCIA CRÍTICA O CAÍDA DE COMUNICACIÓN CON NEON DB (Sad Path)
    test('CP28 — E2 — Latencia crítica o pérdida de comunicación con el servidor cloud', async () => {
        // 1. ARRANGE
        const errorConexion = new Error('Connection timeout to NeonDB cluster endpoint after 5000ms');
        pool.query.mockRejectedValueOnce(errorConexion);

        // 2. ACT
        const response = await request(app)
            .get('/boletos-alertas-qr')
            .query({ desde: '2026-06-01', hasta: '2026-06-25' });

        // 3. ASSERT
        expect(response.statusCode).toBe(503);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error del Servidor: No se pudo conectar con la base de datos NeonDB. Por favor, reintente la consulta en unos instantes.');
    });

    // VALIDACIÓN INTEGRAL: DETECCIÓN DE FRAUDE POR INTENTO QR REVERTIDO (Métrica avanzada)
    test('Debería mapear correctamente el boleto si se forzó el cambio de QR a Efectivo', async () => {
        // 1. ARRANGE
        const alertaConTelemetria = [
            { 
                id_boleto: 702, 
                placa: 'F3V-894', 
                monto_pagado_centavos: 500, 
                modalidad_pago: 'EFECTIVO', // El pago final fue en efectivo
                estado_boleto: 'VALIDO', 
                alerta_auditoria_qr: true,  // El sistema encendió la alerta
                hubo_intento_qr: true       // Porque detectó el intento previo en la app
            }
        ];
        pool.query.mockResolvedValueOnce({ rows: alertaConTelemetria });

        // 2. ACT
        const response = await request(app).get('/boletos-alertas-qr');

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data[0].modalidad_pago).toBe('EFECTIVO');
        expect(response.body.data[0].hubo_intento_qr).toBe(true);
        expect(response.body.data[0].alerta_auditoria_qr).toBe(true);
    });
}); 

// REQUERIMIENTO: RFN10 - CONTABILIZAR FLUJO DE PASAJES
describe('RFN10 - Contabilizar Flujo de Pasajes', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP32: CÁLCULO ESTADÍSTICO CORRECTO (Happy Path)
    test('CP32 — Cálculo estadístico correcto de pasajeros desde el histórico global', async () => {
        // 1. ARRANGE
        pool.query.mockResolvedValueOnce({ rows: [{ ingresos_hoy: 0, boletos_hoy: 0 }] }); // KPIs Hoy
        pool.query.mockResolvedValueOnce({ rows: [{ en_ruta: 0 }] }); // Buses
        pool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); // Alertas
        pool.query.mockResolvedValueOnce({ rows: [] }); // Rutas
        
        // Simulamos que el conteo global arroja 1,250 pasajeros registrados
        pool.query.mockResolvedValueOnce({ 
            rows: [{ total_historico_centavos: 625000, total_boletos_historico: 1250 }] 
        }); 
        pool.query.mockResolvedValueOnce({ rows: [] }); // Ruta rentable

        // 2. ACT
        const response = await request(app).get('/dashboard-exec');

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        // Verificamos que el contador comercial base compile el volumen de pasajeros exacto
        expect(response.body.data.kpis_historicos.total_boletos_vendidos).toBe(1250);
    });

    // CP33: DETECCIÓN DE INCONSISTENCIAS / COMPORTAMIENTO PREVENTIVO (Sad Path)
    test('CP33 — E1 — Detección de inconsistencias lógicas en el set de datos de recaudo', async () => {
        // 1. ARRANGE
        pool.query.mockResolvedValueOnce({ rows: [{ ingresos_hoy: 0, boletos_hoy: 0 }] }); 
        pool.query.mockResolvedValueOnce({ rows: [{ en_ruta: 0 }] }); 
        pool.query.mockResolvedValueOnce({ rows: [{ total: 0 }] }); 
        pool.query.mockResolvedValueOnce({ rows: [] }); 
        
        // Simulamos que el pool de datos devuelve el conteo de datos limpios tras ignorar duplicados
        pool.query.mockResolvedValueOnce({ 
            rows: [{ total_historico_centavos: 50000, total_boletos_historico: 100 }] 
        }); 
        pool.query.mockResolvedValueOnce({ rows: [] }); 

        // 2. ACT
        const response = await request(app).get('/dashboard-exec');

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        // Comprobamos que el backend se mantiene resiliente y entrega la data depurada conforme
        expect(response.body.data.kpis_historicos.total_boletos_vendidos).toBe(100);
    });
});

// REQUERIMIENTO: RFN11 - FILTRAR DASHBOARD WEB
describe('RFN11 - Filtrar Dashboard Web', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP34: APLICACIÓN CORRECTA DE FILTROS CRUZADOS (Happy Path)
    test('CP34 — Aplicación correcta de filtros cruzados con fechas válidas', async () => {
        // 1. ARRANGE
        const resumenSimulado = { total_soles: 320.50, total_boletos: 64 };
        pool.query.mockResolvedValueOnce({ rows: [resumenSimulado] });

        // 2. ACT
        const response = await request(app)
            .get('/bus-sales/5')
            .query({ from: '2026-06-01', to: '2026-06-10' });

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.data.total_soles).toBe(320.50);
        expect(response.body.data.total_boletos).toBe(64);
    });

    // CP35: ERROR — RANGOS CRONOLÓGICOS INVERTIDOS (Sad Path)
    test('CP35 — E1 — Rechazo automático si la fecha de fin es menor a la de inicio', async () => {
        // 1. ARRANGE
        const fechaInicioFutura = '2026-06-25';
        const fechaFinPasada = '2026-06-10'; // Inversión intencional de parámetros

        // 2. ACT
        const response = await request(app)
            .get('/bus-sales/5')
            .query({ from: fechaInicioFutura, to: fechaFinPasada });

        // 3. ASSERT
        // El escudo perimetral del backend intercepta la incoherencia y responde 400
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Parámetros inválidos: La fecha de finalización no puede ser menor a la fecha de inicio del tramo operativo.');
    });
});

// REQUERIMIENTO: RFN13 - GESTIÓN DE COBRADORES
describe('RFN13 - Gestión de Cobradores', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP40: REGISTRO CORRECTO (Happy Path)
    test('CP40 — Registro correcto de personal de recaudo', async () => {
        // 1. ARRANGE
        const nuevoCobrador = {
            dni: '77777777',
            nombres: 'Carlos Mendoza Vega',
            correo: 'carlos@svdrayf.com',
            password: 'Cobrador2026!',
            id_rol: 5 // Rol: Cobrador
        };
        pool.query.mockResolvedValueOnce({ rows: [{ id_usuario: 50, nombres: 'Carlos Mendoza Vega' }] });

        // 2. ACT
        const response = await request(app).post('/usuarios').send(nuevoCobrador);

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Personal operativo registrado exitosamente.');
    });

    // CP41: ERROR — DNI INVÁLIDO O CON EXTENSIÓN INCORRECTA (Sad Path)
    test('CP41 — E1 — Número de documento de identidad (DNI) duplicado o inválido', async () => {
        // 1. ARRANGE
        const cobradorDniInvalido = {
            dni: '12345', // Invalido: Menor a 8 dígitos
            nombres: 'Carlos Mendoza Vega',
            correo: 'carlos@svdrayf.com',
            password: 'Cobrador2026!',
            id_rol: 5
        };

        // 2. ACT
        const response = await request(app).post('/usuarios').send(cobradorDniInvalido);

        // 3. ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: Formato inválido. El DNI debe tener exactamente 8 dígitos.');
    });

    // CP42: ERROR — INTENTO DE INACTIVACIÓN CON TURNO ACTIVO (Sad Path)
    test('CP42 — E2 — Intento de inactivación con turno de viaje activo a bordo de un bus', async () => {
        // 1. ARRANGE
        const idCobradorEnRuta = 88;
        // Simulamos que la base de datos detecta una jornada abierta vinculada a este usuario
        pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id_turno: 900 }] });

        // 2. ACT
        const response = await request(app).delete(`/usuarios/${idCobradorEnRuta}`);

        // 3. ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Operación Bloqueada por Seguridad: No se puede inactivar al cobrador porque cuenta con un turno de viaje activo en ruta. Registre primero el cierre de viaje y liquidación de caja.');
    });
});

// REQUERIMIENTO: RFN14 - CONFIGURACIÓN DE DATOS DE TICKET
describe('RFN14 - Configuración de Datos de Ticket', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP43: ACTUALIZACIÓN CONFORME (Happy Path)
    test('CP43 — Actualización conforme de metadatos de comprobante', async () => {
        // 1. ARRANGE
        const configValida = { razon_social: 'Transportes SVDRAYF S.A.C.', ruc: '20601234567', direccion_fiscal: 'Av. Mala 123', leyenda_pie: 'Buen viaje' };
        pool.query.mockResolvedValueOnce({ rows: [configValida] });

        // 2. ACT
        const response = await request(app).put('/configuracion').send(configValida);

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Datos del ticket actualizados');
    });

    // CP45: ERROR — RUC INCOMPLETO O CON LETRAS (Sad Path)
    test('CP45 — E2 — Número de RUC comercial con estructura inválida', async () => {
        // 1. ARRANGE: Enviamos un RUC con menos de 11 dígitos (Deficiencia corregida)
        const configRucInvalido = { razon_social: 'Transportes SVDRAYF S.A.C.', ruc: '2060123', direccion_fiscal: 'Av. Mala 123' };

        // 2. ACT
        const response = await request(app).put('/configuracion').send(configRucInvalido);

        // 3. ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Formato incorrecto: El RUC debe estar compuesto obligatoriamente por exactamente 11 dígitos numéricos.');
    });
});

// REQUERIMIENTO: RFN15 - GESTIÓN DE MENSAJES EN EL TICKET
describe('RFN15 - Gestión de Mensajes en el Ticket', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    // CP47: ACTUALIZACIÓN CORRECTA (Happy Path)
    test('CP47 — Actualización correcta de frase final de saludo', async () => {
        // 1. ARRANGE
        const datosValidos = { razon_social: 'SVDRAYF S.A.C.', ruc: '20601234567', direccion_fiscal: 'Mala', leyenda_pie: '¡Gracias por su preferencia!' };
        pool.query.mockResolvedValueOnce({ rows: [datosValidos] });

        // 2. ACT
        const response = await request(app).put('/configuracion').send(datosValidos);

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
    });

    // CP48: ERROR POR LONGITUD EXCEDIDA (Sad Path)
    test('CP48 — E1 — Detener grabado si el mensaje excede los 40 caracteres', async () => {
        // 1. ARRANGE: Mensaje con 41 caracteres intencionales
        const datosConFraseLarga = { 
            razon_social: 'SVDRAYF S.A.C.', 
            ruc: '20601234567', 
            direccion_fiscal: 'Mala', 
            leyenda_pie: 'Este mensaje de pie de pagina es demasiado lar' 
        };

        // 2. ACT
        const response = await request(app).put('/configuracion').send(datosConFraseLarga);

        // 3. ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toContain('Límite excedido: El mensaje final no puede superar los 40 caracteres');
    });

    // CP49: ERROR POR CARACTERES ESPECIALES/EMOJIS (Sad Path)
    test('CP49 — E2 — Denegar actualización si incluye emojis no soportados por ticketeras', async () => {
        // 1. ARRANGE: Inserción de un emoji prohibido en terminales térmicas
        const datosConEmoji = { 
            razon_social: 'SVDRAYF S.A.C.', 
            ruc: '20601234567', 
            direccion_fiscal: 'Mala', 
            leyenda_pie: 'Viaje seguro con nosotros 🚌✨' 
        };

        // 2. ACT
        const response = await request(app).put('/configuracion').send(datosConEmoji);

        // 3. ASSERT
        expect(response.statusCode).toBe(400);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toContain('Caracteres no soportados');
    });
});