// tests/logger.test.js
const logger = require('../utils/logger'); 

describe(' Pruebas de Seguridad y Monitoreo - Componente Logger', () => {

    let spyConsole;

    beforeEach(() => {
        spyConsole = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        spyConsole.mockRestore();
    });

    test('Debería formatear el log con la estructura de rúbrica requerica (RF47)', () => {
        logger.info({
            modulo: 'TEST_UNITARIO',
            userId: '999',
            message: 'Verificando traza estructurada'
        });

        expect(spyConsole).toHaveBeenCalled();
        const logImpreso = spyConsole.mock.calls[0][0];
        expect(logImpreso).toContain('[INFO]');
        expect(logImpreso).toContain('[Módulo: TEST_UNITARIO]');
    });

    test('Debería enmascarar automáticamente credenciales y datos sensibles (Prueba de Seguridad)', () => {
        const mensajeConPassword = 'Intento de login con payload: {"user":"cobrador1", "password":"ClaveSecreta123"}';
        logger.info({
            modulo: 'SEGURIDAD_AUTH',
            userId: 'ANÓNIMO',
            message: mensajeConPassword
        });

        const logImpreso = spyConsole.mock.calls[0][0];
        expect(logImpreso).not.toContain('ClaveSecreta123');
        expect(logImpreso).toContain('"password":"********"'); 
    });

    test('Simulación de Monitoreo: Registro de evento crítico [RF22 - Aperturar Turno]', () => {
        logger.info({
            modulo: 'GESTION_TURNOS',
            userId: 'ID-COBRADOR-05',
            message: 'Operación [Aperturar Turno] EXITOSA. Unidad Bus Placa [B4F-789] enlazada de forma conforme en Neon.db.'
        });
        expect(spyConsole).toHaveBeenCalled();
    });

    test('Simulación de Monitoreo: Registro de evento crítico [RF29 - Cerrar Turno]', () => {
        logger.info({
            modulo: 'LIQUIDACION_CAJA',
            userId: 'ID-COBRADOR-05',
            message: 'Operación [Cerrar Turno] CONFORME. Estado congelado en base de datos. Arqueo total consolidado: S/. 345.50.'
        });
        expect(spyConsole).toHaveBeenCalled();
    });

    // NUEVA SIMULACIÓN: Autenticación Conforme (CUS-06 / RF17)
    test('Simulación de Monitoreo: Operación lícita [RF17 - Autenticar Credenciales]', () => {
        logger.info({
            modulo: 'SEGURIDAD_AUTH',
            userId: 'ID-COBRADOR-05',
            message: 'Operación [Autenticar Credenciales] CONFORME. Acceso concedido al ecosistema móvil SVDRAYF.'
        });
        expect(spyConsole).toHaveBeenCalled();
    });

    // NUEVA SIMULACIÓN: Incidencia de Seguridad por Violación de Privilegios (CP123)
    test('Simulación de Monitoreo: Bloqueo de seguridad [RFN41 - Iniciar Sesión Web]', () => {
        logger.warning({
            modulo: 'SEGURIDAD_AUTH',
            userId: 'ID-COBRADOR-05',
            message: 'Acceso Denegado: Operario con perfil de Cobrador intentó forzar una operación ilegal de login en canal Web.'
        });
        expect(spyConsole).toHaveBeenCalled();
    });
});