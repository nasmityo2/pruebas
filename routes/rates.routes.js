const express = require('express');
const router = express.Router();
const ratesController = require('../controllers/rates.controller');

router.get('/', ratesController.getCustomRates);
router.post('/', ratesController.createCustomRate);
router.delete('/:id', ratesController.deleteCustomRate);

module.exports = router;
