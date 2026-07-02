// sw.js — Research Terminal Service Worker
// Bump CACHE_NAME on any change to this file to force the new SW to install
// and purge the previous cache (see the activate handler).
const CACHE_NAME = 'research-terminal-v40';

// Files to cache on install (the app shell)
const SHELL_FILES = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/static/css/app.css',
  '/static/js/01-state-helpers.js',
  '/static/js/02-macro.js',
  '/static/js/03-render.js',
  '/static/js/04-charts.js',
  '/static/js/05-numa.js',
  '/static/js/06-app.js',
  '/static/js/07-research.js',
];

// Install: cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_FILES).catch(err => {
        // Non-fatal: if shell caching fails, app still works
        console.warn('SW: shell cache failed', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only ever handle same-origin GETs. Cross-origin calls (api.anthropic.com,
  // the CDN scripts, fonts) and any non-GET requests (the notes POST, the
  // Anthropic streaming POST) must go straight to the network — routing the
  // Anthropic call through the SW breaks it with "Failed to fetch".
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  // Always go network-first for API endpoints
  if (url.pathname.startsWith('/analyze') ||
      url.pathname.startsWith('/macro') ||
      url.pathname.startsWith('/synthesize') ||
      url.pathname.startsWith('/search') ||
      url.pathname.startsWith('/quote') ||
      url.pathname.startsWith('/notes') ||
      url.pathname.startsWith('/health')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Backend offline — start uvicorn' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Network-first for the page itself (navigations + '/'): always fetch the
  // freshest index.html when the backend is up, fall back to the cached copy
  // only when offline. This is what makes frontend edits show up on the next
  // reload without bumping the cache version.
  if (event.request.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', clone));
        }
        return response;
      }).catch(() => caches.match('/').then(c => c || caches.match(event.request)))
    );
    return;
  }

  // Cache-first for the rest of the app shell (icons, manifest, CDN assets)
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache successful GET responses for shell files
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
