/* =====================================================================
   KALING GAME — Service Worker
   ---------------------------------------------------------------------
   Purpose: Cache STATIC assets only for offline app-shell support.
   NEVER caches:
     • Firebase Authentication        (identitytoolkit, securetoken,
                                       firebaseapp.com, gstatic.com/firebasejs)
     • Realtime Database              (*.firebaseio.com,
                                       *.firebasedatabase.app)
     • Firebase Storage               (*.firebasestorage.app,
                                       firebasestorage.googleapis.com)
     • Google Sign-In                 (accounts.google.com, apis.google.com,
                                       firebaseinstallations.googleapis.com)
     • Razorpay                       (*.razorpay.com)
     • User-specific / authenticated  (any non-GET or any of the above)
   Compatibility: GitHub Pages, Firebase Auth, Google Sign-In,
                  PWABuilder, Bubblewrap, Android Studio TWA.
   No project logic (index.html, Admin.html, Firebase, Wallet,
   Referral, Tournament) is altered by this file.
   ===================================================================== */

/* ── 1. CACHE VERSIONING ────────────────────────────────────────────
   Bump `CACHE_VERSION` on every release. Old caches are auto-purged
   in the `activate` handler. Namespaced keys keep things isolated. */
const CACHE_VERSION   = 'kaling-v1.0.0';
const STATIC_CACHE    = `kaling-static-${CACHE_VERSION}`;
const CDN_CACHE       = `kaling-cdn-${CACHE_VERSION}`;
const CACHE_WHITELIST = [STATIC_CACHE, CDN_CACHE];

/* ── 2. PRECACHE LIST (app shell — same origin) ───────────────────── */
const PRECACHE_URLS = [
    './',
    './index.html',
    'index.html',
    './splash.jpeg',
    './4.webp',
    './IMG-20260629-WA0015.jpg',
    './cs.webp',
    './cs2.webp',
    './low.webp',
    './onetap.jpg',
    './surive.jpg',
    './1782142336456.jpeg',
    './free-fire-photo-16.webp',
    './free-fire-photo-19.webp',
    './free-fire-photo-66.webp',
    './free-fire-photo-75.webp'
];

/* ── 3. NEVER-CACHE LIST (always bypass to network) ─────────────────
   Any request whose URL matches one of these substrings is NEVER
   intercepted, NEVER cached, NEVER served from cache. The browser
   handles it as if no service worker existed. This protects all
   Firebase, Google Auth, and Razorpay traffic. */
const NEVER_CACHE = [
    // Firebase Realtime Database
    'firebaseio.com',
    'firebasedatabase.app',
    // Firebase Storage
    'firebasestorage.app',
    'firebasestorage.googleapis.com',
    // Firebase Auth (handler domain + token + identity APIs)
    'firebaseapp.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseinstallations.googleapis.com',
    // Firebase JS SDK + Auth module (must always load fresh)
    'gstatic.com/firebasejs/',
    // Google Sign-In
    'accounts.google.com',
    'apis.google.com',
    // Razorpay checkout
    'razorpay.com'
];

/* ── 4. RUNTIME-CACHEABLE CDN HOSTS (static UI only) ──────────────── */
const CACHEABLE_CDN_HOSTS = [
    'cdn.jsdelivr.net',     // Bootstrap, Swiper, Bootstrap Icons
    'fonts.googleapis.com', // Font CSS
    'fonts.gstatic.com'     // Font files
];

/* ── 5. SMALL HELPERS ─────────────────────────────────────────────── */
function isNeverCache(url) {
    return NEVER_CACHE.some(rule => url.includes(rule));
}

function isCacheableCDN(url) {
    return CACHEABLE_CDN_HOSTS.some(host => url.includes(host));
}

function isSameOrigin(url) {
    try {
        return new URL(url, self.location.href).origin === self.location.origin;
    } catch (_) {
        return false;
    }
}

/* ── 6. INSTALL — precache app shell ────────────────────────────────
   Each asset is cached individually so that a single failure (e.g.
   a missing file) does not abort the whole install. */
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(STATIC_CACHE);
        await Promise.all(
            PRECACHE_URLS.map(async (url) => {
                try {
                    await cache.add(new Request(url, { cache: 'reload' }));
                } catch (err) {
                    /* Skip this asset — install continues. */
                }
            })
        );
        await self.skipWaiting();
    })());
});

/* ── 7. ACTIVATE — purge old caches ─────────────────────────────────
   Any cache not in the current whitelist is deleted. This is the
   automatic cleanup of stale versions. */
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.map(key => {
                if (!CACHE_WHITELIST.includes(key)) {
                    return caches.delete(key);
                }
            })
        );
        await self.clients.claim();
    })());
});

/* ── 8. FETCH — routing rules ─────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only GET can be safely cached. All Firebase writes (set/update/push)
    // and other mutations bypass to network untouched.
    if (request.method !== 'GET') return;

    let url;
    try { url = request.url; } catch (_) { return; }

    // NEVER cache: Firebase Auth, RTDB, Storage, Google Sign-In, Razorpay.
    if (isNeverCache(url)) return;

    // Cross-origin XHR/fetch that isn't a known static CDN: bypass.
    if (!isSameOrigin(url) && !isCacheableCDN(url)) return;

    event.respondWith((async () => {
        const cached = await caches.match(request);

        // ── Navigation: network-first, fall back to cached app shell.
        // Auth/redirect navigations to google.com/firebaseapp.com are
        // already bypassed above by isNeverCache().
        if (request.mode === 'navigate') {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(STATIC_CACHE);
                cache.put('./index.html', fresh.clone()).catch(() => {});
                return fresh;
            } catch (_) {
                return (await caches.match('./index.html'))
                    || (await caches.match('index.html'))
                    || (await caches.match('./'))
                    || cached
                    || Response.error();
            }
        }

        // ── Same-origin static asset: cache-first.
        if (isSameOrigin(url)) {
            if (cached) return cached;
            try {
                const fresh = await fetch(request);
                if (fresh && (fresh.ok || fresh.type === 'opaque')) {
                    const cache = await caches.open(STATIC_CACHE);
                    cache.put(request, fresh.clone()).catch(() => {});
                }
                return fresh;
            } catch (_) {
                return cached || Response.error();
            }
        }

        // ── Cacheable CDN: stale-while-revalidate.
        if (cached) {
            // Refresh in background; serve cached instantly.
            fetch(request).then(fresh => {
                if (fresh && (fresh.ok || fresh.type === 'opaque')) {
                    caches.open(CDN_CACHE).then(c =>
                        c.put(request, fresh.clone()).catch(() => {})
                    );
                }
            }).catch(() => {});
            return cached;
        }
        try {
            const fresh = await fetch(request);
            if (fresh && (fresh.ok || fresh.type === 'opaque')) {
                const cache = await caches.open(CDN_CACHE);
                cache.put(request, fresh.clone()).catch(() => {});
            }
            return fresh;
        } catch (_) {
            return Response.error();
        }
    })());
});

/* ── 9. MESSAGE — manual update flow (optional, harmless if unused) ─ */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
