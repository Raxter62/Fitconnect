// Keep this version aligned with the HTML footer and local asset URLs.
const APP_VERSION = '2026.10.23.3';
const CACHE_VERSION = `v12-${APP_VERSION}`;
const CACHE_NAME = `fitconnect-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    `./public/css/style.css?v=${APP_VERSION}`,
    `./public/js/main.js?v=${APP_VERSION}`,
    `./public/js/ai_chat.js?v=${APP_VERSION}`,
    `./public/js/features.js?v=${APP_VERSION}`,
    `./public/vendor/lucide.min.js?v=${APP_VERSION}`,
    `./public/js/bg-effects.js?v=${APP_VERSION}`,
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(ASSETS_TO_CACHE.map(path => new Request(new URL(path, self.location.href), { cache: 'reload' })));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 清掉舊版本 cache
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => (k.startsWith('fitconnect-') && k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
        await self.clients.claim(); // 立即接管頁面
    })());
});

// HTML, JS and CSS must be fresh together; images can update in the background.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 只處理同源資源（避免干擾 CDN）
    if (url.origin !== self.location.origin) return;

    // Private APIs and all writes always go to the network, including when offline.
    if (req.method !== 'GET' || url.pathname.endsWith('.php') || url.searchParams.has('action')) return;
    const staticAsset = ASSETS_TO_CACHE.some(path => new URL(path, self.location.href).pathname === url.pathname)
        || /\.(?:png|jpg|jpeg|gif|webp|ico|svg|woff2?)$/i.test(url.pathname);
    if (!staticAsset) return;

    const navigation = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
    if (navigation || /\.(?:js|css)$/i.test(url.pathname)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const fresh = await fetch(req, { cache: 'no-cache' });
                if (fresh.ok) await cache.put(req, fresh.clone());
                return fresh;
            } catch (e) {
                const cached = await cache.match(req);
                return cached || (navigation && await cache.match('./index.html')) || Response.error();
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then(async (fresh) => {
            if (fresh.ok) await cache.put(req, fresh.clone());
            return fresh;
        }).catch(() => null);
        event.waitUntil(fetchPromise);

        return cached || (await fetchPromise) || Response.error();
    })());
});

// 可選：讓頁面主動要求 SW 立即更新
self.addEventListener('message', (event) => {
    if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ version: APP_VERSION });
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
