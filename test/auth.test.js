const request = require('supertest');
const express = require('express');
const router = require('../routes/auth'); // Importa tu nuevo auth.js limpio
const pool = require('../db');
const bcrypt = require('bcryptjs');

// Simulación atómica de la base de datos
jest.mock('../db', () => ({
    query: jest.fn()
}));

const app = express();
app.use(express.json());
app.use('/', router);

describe('RF05 - Iniciar Sesión Web', () => {
    
    afterEach(() => {
        jest.clearAllMocks();
    });

    // =========================================================================
    // CP18: INICIO DE SESIÓN CORRECTO (Happy Path)
    // =========================================================================
    test('CP18 — Inicio de sesión correcto', async () => {
        // 1. ARRANGE
        const credencialesValidas = {
            identificador: 'admin@svdrayf.com',
            password: 'Password123!'
        };

        // Simulamos encontrar al usuario con una contraseña hash pre-calculada
        const hashSimulado = await bcrypt.hash('Password123!', 10);
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 1, nombres: 'Alexander Valverde', correo: 'admin@svdrayf.com', dni: '88888888', password_hash: hashSimulado, id_rol: 1, requiere_cambio: false }]
        });
        
        // Simulamos la inserción en la tabla de auditoría de sesiones
        pool.query.mockResolvedValue({ rowCount: 1 });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesValidas);

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Autenticación exitosa');
        expect(response.body.token).toBeDefined();
    });

    // =========================================================================
    // CP19: ERROR — CREDENCIALES INCORRECTAS (Sad Path)
    // =========================================================================
    test('CP19 — E1 — Credenciales de acceso incorrectas', async () => {
        // 1. ARRANGE
        const credencialesErroneas = {
            identificador: 'admin@svdrayf.com',
            password: 'ClaveIncorrecta'
        };

        const hashSimulado = await bcrypt.hash('Password123!', 10);
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 1, password_hash: hashSimulado }]
        });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesErroneas);

        // 3. ASSERT
        expect(response.statusCode).toBe(401);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: Las credenciales introducidas son incorrectas. Por favor, intente de nuevo.');
    });
});