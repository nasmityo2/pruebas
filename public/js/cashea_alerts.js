// public/js/cashea_alerts.js
(function() {
    async function checkCasheaAlerts() {
        try {
            const response = await fetch('/api/cashea/proximas-cuotas');
            const cuotas = await response.json();

            if (cuotas && cuotas.length > 0) {
                // Si hay cuotas para hoy o mañana
                const hoy = new Date().toISOString().split('T')[0];
                const cuotasHoy = cuotas.filter(c => c.fecha_vencimiento === hoy);
                const cuotasManana = cuotas.filter(c => c.fecha_vencimiento !== hoy);

                if (cuotasHoy.length > 0) {
                    showCasheaToast(`Tienes ${cuotasHoy.length} pagos de Cashea que vencen HOY.`, 'warning');
                }
                if (cuotasManana.length > 0) {
                    showCasheaToast(`Tienes ${cuotasManana.length} pagos de Cashea que vencen mañana.`, 'info');
                }
            }
        } catch (error) {
            console.error('Error al verificar alertas de Cashea:', error);
        }
    }

    function showCasheaToast(message, type) {
        if (window.Toast) {
            window.Toast.show(message, type);
        } else {
            console.log(`[CASHEA ALERT] ${type}: ${message}`);
        }
    }

    // Verificar cada 6 horas
    checkCasheaAlerts();
    setInterval(checkCasheaAlerts, 6 * 60 * 60 * 1000);
})();
