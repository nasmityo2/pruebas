const CACHE_NAME = 'bodegapp-license-v3-network-first';
const ASSETS = [
    './img/icon.ico',
    './css/style.css',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) => {
                return Promise.all(keys.map((k) => caches.delete(k)));
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

    // For CSS/Images -> Network First, Fallback to Cache
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
