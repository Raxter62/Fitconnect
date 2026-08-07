// service-worker.js
// 目標：保留原本離線快取功能，但修復「永遠吃到舊 main.js」的問題（cache-first + 固定版本號）。

// 每次你更新前端資源（main.js / css / html），把版本號改一下即可。
// 這不會改變任何功能，只是讓瀏覽器知道要更新快取。
const CACHE_VERSION = 'v4-2025-12-31-cleanup-complete';
const CACHE_NAME = `fitconnect-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './public/css/style.css',
    './public/js/main.js',
    './public/js/ai_chat.js',
    './public/js/bg-effects.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // 立即進入 waiting -> activate
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
            .catch((err) => console.log('Cache addAll error:', err))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 清掉舊版本 cache
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
        await self.clients.claim(); // 立即接管頁面
    })());
});

// 策略：
// - 對 HTML 導航：network-first（確保更新）
// - 對 main.js/其他靜態資源：stale-while-revalidate（先用快取，背景更新）
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 只處理同源資源（避免干擾 CDN）
    if (url.origin !== self.location.origin) return;

    // 導航請求（index.html 等）—優先網路，失敗再用快取
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE_NAME);
                cache.put(req, fresh.clone());
                return fresh;
            } catch (e) {
                const cached = await caches.match(req);
                return cached || caches.match('./index.html');
            }
        })());
        return;
    }

    // JS/CSS 等靜態資源：stale-while-revalidate
    event.respondWith((async () => {
        const cached = await caches.match(req);
        const fetchPromise = fetch(req).then(async (fresh) => {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone());
            return fresh;
        }).catch(() => null);

        // main.js 特別重要：如果有新版本，要盡快更新
        // 先回 cached（快），同時背景更新；若沒 cached，等網路
        return cached || (await fetchPromise) || cached;
    })());
});

// 可選：讓頁面主動要求 SW 立即更新
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});