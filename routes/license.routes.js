const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/license.controller');

router.get('/info', licenseController.getLicenseInfo);
router.get('/check-update-status', licenseController.checkUpdateStatus);
router.get('/check-update-online', licenseController.checkUpdateOnline);
router.post('/activate', licenseController.activateLicense);
router.post('/start-trial', licenseController.startTrial);
router.post('/sync-contact', licenseController.syncLicenseContact);

module.exports = router;