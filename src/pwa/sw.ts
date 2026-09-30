const CACHE_NAME = 'juzu-cache-v1';
const ASSET_CACHE_NAME = 'juzu-assets-v1';
const PRECACHE_ASSETS: string[] = ['__PRECACHE_ASSETS__'];

self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const shell = [
        '/juzu/',
        '/juzu/index.html',
        '/juzu/manifest.webmanifest',
        '/juzu/icons/icon-192.png',
        '/juzu/icons/icon-512-maskable.png'
      ];
      // Only cache these initially, others will be precached on demand
      return cache.addAll(shell);
    })
  );
  (self as any).skipWaiting();
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== ASSET_CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return null;
        })
      );
    })
  );
  (self as any).clients.claim();
});

self.addEventListener('fetch', (event: any) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        // Cache-first: Return cached response immediately
        // Background revalidation
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(ASSET_CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // Ignore network errors on revalidation
        });
        return response;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Don't clone and cache if it's not a standard asset, but let's cache everything we fetch for now.
        const responseToCache = networkResponse.clone();
        caches.open(ASSET_CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
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

    caches.open(ASSET_CACHE_NAME).then(async (cache) => {
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
    caches.delete(ASSET_CACHE_NAME).then(() => {
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
