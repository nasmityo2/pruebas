// routes/rapikom.routes.js
const express = require('express');
const router = express.Router();
const rapikomController = require('../controllers/rapikom.controller');

router.post('/', rapikomController.createRapikomVenta);
router.get('/pendientes', rapikomController.getRapikomPendientes);
router.put('/:id/reconciliar', rapikomController.reconciliarVentaRapikom);

module.exports = router;
