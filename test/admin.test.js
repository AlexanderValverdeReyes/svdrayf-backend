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