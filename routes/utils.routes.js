const express = require('express');
const router = express.Router();
const utilsController = require('../controllers/utils.controller');

router.get('/local-ip', utilsController.getLocalIp);
router.get('/qrcode', utilsController.getQrCode);
router.get('/download-progress', utilsController.getDownloadProgress);
router.post('/download-update', utilsController.downloadUpdate);
router.post('/execute-update', utilsController.executeUpdate);

router.post('/configure-firewall', utilsController.configureFirewall);

router.get('/lan-status', utilsController.getLanStatus);
router.post('/lan-enable', utilsController.setLanMode);

module.exports = router;