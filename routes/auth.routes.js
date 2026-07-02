const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.get('/status', authController.getAuthStatus);
router.post('/set', authController.setAdminPassword);
router.post('/verify', authController.verifyAdminPassword);

module.exports = router;