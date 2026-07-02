const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');

router.get('/users', adminController.getUsers);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

router.get('/audit', adminController.getAudit);

module.exports = router;
