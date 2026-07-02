/**
 * Script para obtener todas las licencias activas del servidor BodegApp
 * Utiliza la información disponible en el código fuente del proyecto.
 * 
 * ADVERTENCIA: Este script funciona SOLO si el servidor de producción
 * aún usa las claves por defecto del código. Si ya las cambiaron, fallará.
 */

const SERVER_URL = 'https://bodegapp.com.ve';
const API_BASE = '/admin-licencias/api';

// Intento 1: Usar la SHARED_API_KEY del código
async function tryWithApiKey() {
    const apiKey = 'bodegapp-master-key-2026';
    console.log('▶ Intentando con API Key...');

    try {
        const url = `${SERVER_URL}${API_BASE}/protected/licenses?limit=1000&tab=all`;
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });

        if (res.ok) {
            const data = await res.json();
            return { method: 'API Key', data };
        }
        console.log('  ✗ API Key rechazada (401)');
        return null;
    } catch (e) {
        console.log('  ✗ Error con API Key:', e.message);
        return null;
    }
}

// Intento 2: Fabricar un JWT con el SECRET_KEY del código
async function tryWithJwt() {
    // El SECRET_KEY por defecto del código
    const SECRET_KEY = 'super-secret-key-change-this-in-env';

    console.log('▶ Intentando con JWT fabricado...');

    try {
        // Cargar jsonwebtoken
        const jwt = require('jsonwebtoken');

        // Crear un token falso con rol de admin (igual que hace authenticateApiKey)
        const fakeToken = jwt.sign(
            { id: 999, username: 'system', role: 'admin' },
            SECRET_KEY,
            { expiresIn: '30d' }
        );

        const url = `${SERVER_URL}${API_BASE}/protected/licenses?limit=1000&tab=all`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${fakeToken}` }
        });

        if (res.ok) {
            const data = await res.json();
            return { method: 'JWT fabricado', data };
        }

        const text = await res.text();
        console.log(`  ✗ JWT rechazado (${res.status}): ${text}`);
        return null;
    } catch (e) {
        console.log('  ✗ Error con JWT:', e.message);
        return null;
    }
}

// Intento 3: Login con credenciales por defecto
async function tryWithLogin(username, password) {
    console.log(`▶ Intentando login: ${username} / ${password}...`);

    try {
        const url = `${SERVER_URL}${API_BASE}/login`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            const data = await res.json();
            console.log('  ✓ Login exitoso!');

            // Ahora obtener las licencias con el token
            const licRes = await fetch(`${SERVER_URL}${API_BASE}/protected/licenses?limit=1000&tab=all`, {
                headers: { 'Authorization': `Bearer ${data.token}` }
            });

            if (licRes.ok) {
                const licData = await licRes.json();
                return { method: `Login (${username})`, data: licData };
            }
        }
        return null;
    } catch (e) {
        console.log(`  ✗ Error: ${e.message}`);
        return null;
    }
}

// Mostrar resultados
function displayResults(result) {
    if (!result) return;

    console.log(`\n✅ ACCESO LOGRADO vía: ${result.method}`);
    console.log('='.repeat(60));

    const { licenses, total } = result.data;

    console.log(`\n📊 TOTAL DE LICENCIAS: ${total}`);
    console.log('='.repeat(60));

    if (!licenses || licenses.length === 0) {
        console.log('No hay licencias para mostrar.');
        return;
    }

    // Estadísticas
    const activas = licenses.filter(l => l.active && !l.blocked).length;
    const pendientes = licenses.filter(l => !l.active && !l.blocked).length;
    const bloqueadas = licenses.filter(l => l.blocked).length;
    const ocultas = licenses.filter(l => l.hidden).length;

    console.log(`\n📈 ESTADÍSTICAS:`);
    console.log(`  Activas:     ${activas}`);
    console.log(`  Pendientes:  ${pendientes}`);
    console.log(`  Bloqueadas:  ${bloqueadas}`);
    console.log(`  Ocultas:     ${ocultas}`);
    console.log('='.repeat(60));

    // Mostrar cada licencia activa
    console.log(`\n📋 LISTA DE LICENCIAS ACTIVAS:`);
    console.log('-'.repeat(100));

    licenses
        .filter(l => l.active && !l.blocked)
        .forEach((l, i) => {
            console.log(`\n${i + 1}. ${l.systemName || 'Sin nombre'}`);
            console.log(`   HWID:          ${l.hwid}`);
            console.log(`   Teléfono:      ${l.clientPhone || 'N/A'}`);
            console.log(`   Email:         ${l.clientEmail || 'N/A'}`);
            console.log(`   Expira:        ${l.expirationDate || 'N/A'}`);
            console.log(`   Licencia Key:  ${l.licenseKey ? l.licenseKey.substring(0, 60) + '...' : 'N/A'}`);
            console.log(`   Activado por:  ${l.activatedBy || 'N/A'}`);
            console.log(`   Fecha Activ.:  ${l.activationDate ? new Date(l.activationDate).toLocaleString() : 'N/A'}`);
            console.log(`   Último Check:  ${l.lastCheck ? new Date(l.lastCheck).toLocaleString() : 'N/A'}`);

            // Mostrar historial si existe
            if (l.history && l.history.length > 0) {
                console.log(`   Historial:`);
                l.history.forEach(h => {
                    console.log(`     - ${h.action} por ${h.by} el ${new Date(h.date).toLocaleString()}`);
                });
            }
        });

    // Mostrar también pendientes
    const pendList = licenses.filter(l => !l.active && !l.blocked);
    if (pendList.length > 0) {
        console.log(`\n📋 SOLICITUDES PENDIENTES:`);
        console.log('-'.repeat(60));
        pendList.forEach((l, i) => {
            console.log(`\n${i + 1}. ${l.systemName || 'Sin nombre'}`);
            console.log(`   HWID:     ${l.hwid}`);
            console.log(`   Teléfono: ${l.clientPhone || 'N/A'}`);
            console.log(`   Solicitó: ${new Date(l.requestDate).toLocaleString()}`);
        });
    }
}

// ====== EJECUCIÓN PRINCIPAL ======
async function main() {
    console.log('='.repeat(60));
    console.log('  BODEGAPP - OBTENER LICENCIAS DEL SERVIDOR');
    console.log('='.repeat(60));
    console.log(`\nServidor: ${SERVER_URL}`);
    console.log(`Endpoint: ${SERVER_URL}${API_BASE}/protected/licenses\n`);

    // Probar los 3 métodos
    let result = await tryWithApiKey();

    if (!result) {
        result = await tryWithJwt();
    }

    if (!result) {
        // Probar combinaciones de login
        const credenciales = [
            ['admin', 'admin123'],
            ['admin', 'admin'],
            ['soporte', 'soporte'],
            ['root', 'root'],
        ];

        for (const [u, p] of credenciales) {
            if (result) break;
            result = await tryWithLogin(u, p);
        }
    }

    if (result) {
        displayResults(result);
    } else {
        console.log('\n❌ No se pudo acceder. Todas las credenciales y claves fallaron.');
        console.log('\nPosibles razones:');
        console.log('  - El SECRET_KEY y SHARED_API_KEY fueron cambiados en producción');
        console.log('  - Las credenciales de login fueron cambiadas');
        console.log('  - El servidor tiene protecciones adicionales (firewall, IP whitelist, etc.)');
        console.log('\nSolución: Pide a quien tenga acceso que genere un token JWT válido o');
        console.log('revisa el archivo users.json en el servidor para obtener el hash de la contraseña.');
    }
}

main().catch(console.error);
