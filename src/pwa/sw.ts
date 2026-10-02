// P-FRESH: the old service worker was a permanent stale-deploy trap:
//  - cache names were NEVER bumped ('juzu-cache-v1' forever), and activate
//    only deleted caches that didn't match those same constant names, so the
//    install-time shell (index.html + entry bundle) survived every deploy;
//  - the fetch handler was cache-FIRST: the cached response was returned
//    immediately, and its background "revalidation" wrote the fresh copy into
//    a DIFFERENT cache (juzu-assets-v1) that caches.match() never preferred
//    (juzu-cache-v1 is created first and wins the unspecified match order).
//  Net effect: a device that installed the SW once NEVER received any later
//  build — the owner's iPhone was playing a pre-touch, pre-canon bundle no
//  matter how many PRs merged. Every complaint trace ("character doesn't
//  move", "graphics awful") is consistent with that stale bundle.
//
// New policy:
//  - cache names carry a build-stamped VERSION (injected by vite.config.ts
//    pwaAssetsPlugin). activate purges EVERY juzu-* cache not in the current
//    version pair, so a deploy can never leave stale shells behind.
//  - navigation requests are NETWORK-FIRST (cache only as offline fallback):
//    online users always get the current index.html → current hashed bundle.
//  - /juzu/assets/* are content-hashed → cache-first is safe and fast.
//  - everything else: stale-while-revalidate reading AND writing the SAME
//    cache (the old write-vs-read cache split is gone).
const VERSION = '__SW_VERSION__';
const SHELL_CACHE = `juzu-shell-${VERSION}`;
const ASSET_CACHE = `juzu-assets-${VERSION}`;
const PRECACHE_ASSETS: string[] = ['__PRECACHE_ASSETS__'];

const SHELL_URLS = [
  '/juzu/',
  '/juzu/index.html',
  '/juzu/manifest.webmanifest',
  '/juzu/icons/icon-192.png',
  '/juzu/icons/icon-512-maskable.png'
];

self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_URLS);
    })
  );
  (self as any).skipWaiting();
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Purge every cache from any previous version (old shells, old
          // asset caches, and the pre-P-FRESH 'juzu-cache-v1' /
          // 'juzu-assets-v1' pair) — only the current pair survives.
          if (cacheName === SHELL_CACHE || cacheName === ASSET_CACHE) {
            return null;
          }
          if (cacheName.startsWith('juzu-')) {
            return caches.delete(cacheName);
          }
          return null;
        })
      );
    })
  );
  (self as any).clients.claim();
});

// Navigation fetches must reach the network whenever the device is online —
// this is what delivers every future deploy to previously-installed clients.
// Offline (or on failure), fall back to the cached shell.
async function handleNavigation(request: Request): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/juzu/index.html', networkResponse.clone());
      return networkResponse;
    }
    // Non-200 from the network: try the shell, else pass through.
    const cached = await caches.match('/juzu/index.html');
    return cached || networkResponse;
  } catch (e) {
    const cached = await caches.match('/juzu/index.html');
    if (cached) return cached;
    throw e;
  }
}

// Content-hashed build assets: immutable, cache-first is correct.
async function handleHashedAsset(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.status === 200) {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

// Same-origin misc (icons, libs, textures fetched at runtime):
// stale-while-revalidate against ASSET_CACHE — read and write the SAME cache.
async function handleOther(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  const networkFetch = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      caches.open(ASSET_CACHE).then((cache) => {
        cache.put(request, networkResponse.clone());
      });
    }
    return networkResponse;
  }).catch(() => null);
  return cached || (await networkFetch) || Response.error();
}

self.addEventListener('fetch', (event: any) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  // Same-origin only (cross-origin requests pass through untouched).
  if (url.origin === self.location.origin && url.pathname.startsWith('/juzu/assets/')) {
    event.respondWith(handleHashedAsset(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(handleOther(event.request));
  }
});

self.addEventListener('message', (event: any) => {
  if (event.data && event.data.type === 'DOWNLOAD_OFFLINE') {
    const port = event.ports[0];
    if (!port) return;

    // Filter out the placeholder if we didn't inject anything
    const assetsToCache = PRECACHE_ASSETS.filter(a => a && a !== '__PRECACHE_ASSETS__');

    let cachedCount = 0;
    const totalCount = assetsToCache.length;

    if (totalCount === 0) {
       port.postMessage({ type: 'PROGRESS', progress: 100 });
       port.postMessage({ type: 'COMPLETE' });
       return;
    }

    caches.open(ASSET_CACHE).then(async (cache) => {
      for (const asset of assetsToCache) {
        try {
          const response = await cache.match(asset);
          if (!response) {
             await cache.add(asset);
          }
        } catch (e) {
          console.warn('Failed to precache asset:', asset, e);
        }
        cachedCount++;
        port.postMessage({ type: 'PROGRESS', progress: Math.floor((cachedCount / totalCount) * 100) });
      }
      port.postMessage({ type: 'COMPLETE' });
    }).catch((err) => {
      port.postMessage({ type: 'ERROR', error: err.toString() });
    });
  } else if (event.data && event.data.type === 'CLEAR_OFFLINE') {
    const port = event.ports[0];
    if (!port) return;

    // Only delete the asset cache, NOT the shell cache
    caches.delete(ASSET_CACHE).then(() => {
       port.postMessage({ type: 'CLEARED' });
    });
  } else if (event.data && event.data.type === 'GET_ASSET_SIZE') {
    const port = event.ports[0];
    if (!port) return;

    // Send back the number of assets to give a rough estimate or we can just send the list
    const assetsToCache = PRECACHE_ASSETS.filter(a => a && a !== '__PRECACHE_ASSETS__');
    port.postMessage({ type: 'ASSET_SIZE', count: assetsToCache.length });
  }
});
