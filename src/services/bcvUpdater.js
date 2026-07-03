const https = require('https');
const cheerio = require('cheerio');
const { db } = require('../database');

// BCV URL
const BCV_URL = 'https://www.bcv.org.ve/';

function fetchRate() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.bcv.org.ve',
            path: '/',
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            rejectUnauthorized: false,
            timeout: 20000
        };

        console.log('Attempting to scrape BCV directly...');

        const req = https.get(options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`BCV Website Request Failed: ${res.statusCode}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const $ = cheerio.load(data);
                    
                    // 1. Direct targeted selector for USD
                    let rawRate = $('#dolar strong').text().trim();
                    
                    // 2. Fallback selector restricted to elements related to dollar
                    if (!rawRate) {
                        $('#dolar, .dolar, [id*="dolar"]').find('strong').each((i, el) => {
                            rawRate = $(el).text().trim();
                            if (rawRate) return false; // break loop
                        });
                    }

                    // 3. Fallback text search restricted to the same container element, avoiding cross-contamination with Euro
                    if (!rawRate) {
                        $('.field-content, .recuadrotsmc, tr, td').each((i, el) => {
                            const text = $(el).text().trim();
                            if (text.includes('USD') && !text.includes('EUR')) {
                                const strong = $(el).find('strong');
                                if (strong.length > 0) {
                                    rawRate = strong.first().text().trim();
                                    return false; // break loop
                                }
                            }
                        });
                    }
                    
                    if (!rawRate) {
                        return reject(new Error('Rate not found in BCV HTML structure'));
                    }

                    // Normalize: remove thousands separator (.) and replace decimal separator (,) with (.)
                    const normalizedRate = rawRate.replace(/\./g, '').replace(',', '.');
                    const rate = parseFloat(normalizedRate);

                    if (!rate || isNaN(rate) || rate <= 0) {
                        return reject(new Error(`Invalid rate parsed from BCV: ${rawRate}`));
                    }

                    console.log(`Successfully scraped BCV rate: ${rate}`);
                    resolve({
                        promedio: rate,
                        fechaActualizacion: new Date().toISOString()
                    });

                } catch (e) {
                    reject(new Error(`Error parsing BCV response: ${e.message}`));
                }
            });
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('BCV Request Timed Out'));
        });
    });
}

// Update rate. force = true skips the database check (for manual updates)
function updateBCVRate(force = true) {
    if (force) {
        console.log('Starting BCV rate update check (Manual/Force)...');
    } else {
        console.log('Starting BCV rate update check (Scheduled)...');
        // Check if Auto-Update is enabled
        try {
            const stmt = db.prepare("SELECT value FROM settings WHERE key = 'AUTO_BCV'");
            const row = stmt.get();
            const autoEnabled = row ? (row.value === '1' || row.value === 1 || row.value === 'true') : false;

            if (!autoEnabled) {
                console.log('Auto-Update is disabled. Skipping check.');
                return Promise.resolve(); 
            }
        } catch (err) {
            console.error('Error checking AUTO_BCV setting:', err.message);
            return Promise.resolve();
        }
    }

    return fetchRate()
        .catch(err => {
            console.warn(`Direct scraping failed: ${err.message}. Trying Centralized API fallback...`);
            // Fallback opcional a API centralizada (desactivado por defecto; sin dominio externo hardcodeado).
            const { RATES_FALLBACK_URL } = require('../config');
            if (!RATES_FALLBACK_URL) {
                return Promise.reject(new Error('Fallback de tasas desactivado (RATES_FALLBACK_URL no configurado).'));
            }
            return new Promise((resolve, reject) => {
                const API_URL = RATES_FALLBACK_URL;
                https.get(API_URL, { timeout: 10000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            let rate = json.bcv || (json.tasas && json.tasas.bcv) || json.usd;
                            if (rate) resolve({ promedio: parseFloat(rate), fechaActualizacion: new Date().toISOString() });
                            else reject(new Error('No rate in API response'));
                        } catch (e) { reject(e); }
                    });
                }).on('error', reject);
            });
        })
        .then(data => {
            if (!data) return;
            const newRate = parseFloat(data.promedio);
            if (isNaN(newRate)) {
                console.error('Invalid rate data received:', data);
                return;
            }

            // Get current rate from DB
            const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
            const currentRateRow = stmt.get('BCV');
            const currentRate = currentRateRow ? parseFloat(currentRateRow.value) : 0;

            console.log(`Current Rate: ${currentRate}, New Rate: ${newRate.toFixed(8)}`);

            // Update if different (threshold 0.00001 for high precision)
            if (Math.abs(newRate - currentRate) > 0.00001) {
                const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
                updateStmt.run('BCV', newRate.toFixed(8));
                console.log(`BCV rate updated to ${newRate.toFixed(8)}`);
                return newRate; 
            } else {
                console.log('BCV rate unchanged');
                return currentRate;
            }
        })
        .catch(err => {
            console.error('Error updating BCV rate (All methods failed):', err.message);
        });
}

// Scheduler logic
// A.6: se guardan las referencias de timers para poder limpiarlas al cerrar (evita fugas).
let _bootTimer = null;
let _intervalTimer = null;

function startScheduler() {
    console.log('Starting BCV update scheduler...');

    // Run immediately on startup (respecting auto setting)
    _bootTimer = setTimeout(() => {
        updateBCVRate(false);
    }, 5000);

    // Schedule runs every 30 minutes (30 * 60 * 1000 = 1800000 ms)
    _intervalTimer = setInterval(() => {
        updateBCVRate(false);
    }, 30 * 60 * 1000);
}

function stopScheduler() {
    if (_bootTimer) { clearTimeout(_bootTimer); _bootTimer = null; }
    if (_intervalTimer) { clearInterval(_intervalTimer); _intervalTimer = null; }
}

module.exports = { updateBCVRate, startScheduler, stopScheduler };

