const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');

router.post('/', salesController.processSale);
router.get('/:id/receipt', salesController.getSaleReceipt);
router.get('/:id/details', salesController.getSaleDetails);
router.post('/:id/change', salesController.registerChange);

module.exports = router;