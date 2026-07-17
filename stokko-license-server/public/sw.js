const CACHE_NAME = 'stokko-license-v4-network-first';
const ASSETS = [
    './img/icon.ico',
    './css/style.css'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) => {
                return Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
            })
        ])
    );
});

self.addEventListener('fetch', (e) => {
    // STRATEGY: NETWORK ONLY for HTML and API.
    // We don't want to cache the dashboard logic anymore to prevent stale versions.
    // Only cache static assets (images, css) if needed, but even then, safer to verify network.

    const url = new URL(e.request.url);

    // If it's an API call or the HTML page itself -> NETWORK ONLY
    if (url.pathname.includes('/api/') || e.request.destination === 'document' || url.pathname.endsWith('.html')) {
        e.respondWith(fetch(e.request));
        return;
    }

    if (url.origin !== self.location.origin) {
        e.respondWith(fetch(e.request));
        return;
    }

    // For local CSS/Images -> Network First, Fallback to the current branded cache
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
