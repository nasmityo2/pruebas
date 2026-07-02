// routes/client.routes.js
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/client.controller');

// Lista de clientes con resumen de deuda
router.get('/', clientController.getClients);

// Crear / actualizar / eliminar cliente
router.post('/', clientController.createClient);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

// Deudas detalladas por cliente
router.get('/:id/debts', clientController.getClientDebts);

// Deudas con productos incluidos (para mensaje WhatsApp)
router.get('/:id/debts-with-products', clientController.getClientDebtsWithProducts);

// Registrar un abono (para una venta concreta)
router.post('/payment', clientController.registerPayment);
// Registrar abono masivo / a cuenta
router.post('/payment/bulk', clientController.bulkRegisterPayment);

router.post('/payment/:id/void', clientController.voidPayment);

module.exports = router;
