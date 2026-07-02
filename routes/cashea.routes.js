// routes/cashea.routes.js
const express = require('express');
const router = express.Router();
const casheaController = require('../controllers/cashea.controller');

router.post('/', casheaController.createCasheaVenta);
router.get('/cliente/:cliente_id', casheaController.getCasheaVentasByCliente);
router.get('/cuotas/:cashea_venta_id', casheaController.getCasheaCuotas);
router.put('/cuotas/:cuota_id/pagar', casheaController.PagarCuota);
router.get('/proximas-cuotas', casheaController.getProximasCuotas);
router.get('/pendientes', casheaController.getCasheaPendientesConciliacion);
router.put('/:id/reconciliar', casheaController.reconciliarVentaCashea);

module.exports = router;
