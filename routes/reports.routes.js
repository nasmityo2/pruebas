// routes/reports.routes.js
const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');

// Resumen diario de ventas
router.get('/daily-close', reportsController.getDailyCloseReport);

// Lista de reposición del día (solo nombre + cantidad, sin precios)
router.get('/daily-restock', reportsController.getDailyRestockList);

// Reportes por rango
router.get('/range', reportsController.getReportByDateRange);
router.get('/range/pdf', reportsController.getReportByDateRangePDF);
router.get('/range/excel', reportsController.exportSalesReportExcel);

// Abonos por rango
router.get('/payments-range', reportsController.getPaymentsByDateRange);

// Búsqueda Global
router.get('/search', reportsController.searchSales);

// Resumen de pagos del día (para Cierre Z)
router.get('/summary', reportsController.getTodayPaymentSummary);
router.post('/print-cierre-z', reportsController.printCierreZ);

// Anular venta
router.delete('/void/:saleId', reportsController.voidSale);

// Dashboard
router.get('/dashboard-stats', reportsController.getTodayDashboardStats);
router.get('/top-products', reportsController.getTopSellingProducts);

// Registrar retiro de caja (Bs / USD)
router.post('/cash-withdrawal', reportsController.registerCashWithdrawal);

// NUEVO: Registrar Avance de Efectivo
router.post('/cash-advance', reportsController.registerCashAdvance);

// 🔹 NUEVO: Apertura de caja (inicio de caja del día)
router.post('/cash-opening', reportsController.registerCashOpening);
router.get('/cash-opening/today', reportsController.getTodayCashOpening);

// NUEVO: imprimir inventario y fiados en PDF
router.get('/inventory-pdf', reportsController.printInventoryPdf);
router.get('/fiados-pdf', reportsController.printFiadosPdf);

// 🔹 NUEVO: Historial de cierres Z
router.get('/cierre-z/history', reportsController.getCierreZHistory);

// 🔹 NUEVO: Reimpresión / visualización de un cierre Z en PDF
router.get('/cierre-z/:id/pdf', reportsController.printCierreZById);

module.exports = router;
