const express = require('express');
const router = express.Router();
const paymentMethodController = require('../controllers/paymentMethod.controller');

router.get('/', paymentMethodController.getPaymentMethods);
router.post('/', paymentMethodController.createPaymentMethod);
router.delete('/:id', paymentMethodController.deletePaymentMethod);

module.exports = router;
