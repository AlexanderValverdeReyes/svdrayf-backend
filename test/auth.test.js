const request = require('supertest');
const express = require('express');
const router = require('../routes/auth'); 
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

    // CP18: INICIO DE SESIÓN CORRECTO (Happy Path)
    test('CP18 — Inicio de sesión correcto', async () => {
        // 1. ARRANGE
        const credencialesValidas = {
            identificador: 'admin@svdrayf.com',
            password: 'Password123!',
            es_web: true
        };

        const hashSimulado = await bcrypt.hash('Password123!', 10);
        pool.query.mockResolvedValueOnce({
            rows: [{ 
                id_usuario: 1, 
                nombres: 'Alexander Valverde', 
                correo: 'admin@svdrayf.com', 
                dni: '88888888', 
                password_hash: hashSimulado, 
                id_rol: 1, 
                requiere_cambio: false,
                activo: true 
            }]
        });
        
        pool.query.mockResolvedValue({ rowCount: 1 });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesValidas);

        // 3. ASSERT
        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe('OK');
        expect(response.body.message).toBe('Autenticación exitosa');
        expect(response.body.token).toBeDefined();
    });

    // CP19: ERROR — CREDENCIALES INCORRECTAS (Sad Path)
    test('CP19 — E1 — Credenciales de acceso incorrectas', async () => {
        // 1. ARRANGE
        const credencialesErroneas = {
            identificador: 'admin@svdrayf.com',
            password: 'ClaveIncorrecta',
            es_web: true
        };

        const hashSimulado = await bcrypt.hash('Password123!', 10);
        pool.query.mockResolvedValueOnce({
            rows: [{ id_usuario: 1, password_hash: hashSimulado, activo: true }]
        });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesErroneas);

        // 3. ASSERT
        expect(response.statusCode).toBe(401);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error: Las credenciales introducidas son incorrectas. Por favor, intente de nuevo.');
    });

    // CP123: ERROR — INTENTO DE ACCESO A PANTALLAS NO AUTORIZADAS (Sad Path)
    test('CP123 — E1 — Intento de acceso de perfil no autorizado a la plataforma Web', async () => {
        // 1. ARRANGE
        const credencialesOperativo = {
            identificador: 'fiscalizador@svdrayf.com',
            password: 'Password123!',
            es_web: true // Intento forzado de loguearse en el entorno web
        };

        // Simulamos encontrar a un usuario con id_rol = 4 (Fiscalizador)
        pool.query.mockResolvedValueOnce({
            rows: [{ 
                id_usuario: 10, 
                nombres: 'Inspector Control', 
                correo: 'fiscalizador@svdrayf.com', 
                dni: '77776666', 
                id_rol: 4, 
                requiere_cambio: false,
                activo: true 
            }]
        });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesOperativo);

        // 3. ASSERT
        expect(response.statusCode).toBe(403);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Acceso denegado: Operación ilegal. Su perfil no cuenta con permisos autorizados para iniciar sesión en la plataforma Web.');
    });

    // EXCEPCIÓN: INTENTO DE ACCESO CON DNI EXPIRADO (Sad Path)
    test('E2 — Intento de inicio de sesión con DNI provisional cuando ya caducó', async () => {
        // 1. ARRANGE
        const credencialesDniProhibido = {
            identificador: 'cobrador@svdrayf.com',
            password: '44445555', // El cobrador intenta usar su DNI como clave
            es_web: false
        };

        // El usuario ya cambió su clave en el pasado (requiere_cambio = false)
        const hashProvisionalSobrante = await bcrypt.hash('44445555', 10);
        pool.query.mockResolvedValueOnce({
            rows: [{ 
                id_usuario: 12, 
                nombres: 'Cobrador Ruta', 
                correo: 'cobrador@svdrayf.com', 
                dni: '44445555', 
                password_hash: hashProvisionalSobrante, 
                id_rol: 5, 
                requiere_cambio: false, // Candado de expiración activo
                activo: true 
            }]
        });

        // 2. ACT
        const response = await request(app).post('/login').send(credencialesDniProhibido);

        // 3. ASSERT
        expect(response.statusCode).toBe(401);
        expect(response.body.status).toBe('ERROR');
        expect(response.body.message).toBe('Error de seguridad: El uso de su DNI como contraseña provisional ha expirado. Debe utilizar su clave cifrada definitiva.');
    });
});