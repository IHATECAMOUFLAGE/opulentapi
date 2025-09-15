const CACHE_NAME = 'proxy-site-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/lib/rewriter/inject.js',
  '/styles.css',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

function getProxiedUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('/api/proxy?url=')) return url;
  } catch {}
  return '/api/proxy?url=' + encodeURIComponent(url);
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/proxy')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET') {
    event.respondWith((async () => {
      try {
        return fetch(getProxiedUrl(request.url), {
          method: request.method,
          headers: request.headers,
          body: request.method === 'POST' ? await request.clone().text() : undefined,
          redirect: 'follow'
        });
      } catch (err) {
        return new Response('Proxy fetch failed: ' + err.message, { status: 500 });
      }
    })());
    return;
  }

  const isStatic = STATIC_ASSETS.includes(url.pathname);
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff)$/i.test(url.pathname);

  if (isImage) {
    event.respondWith(fetch(getProxiedUrl(request.url)));
    return;
  }

  if (!isStatic) {
    event.respondWith((async () => {
      try {
        return fetch(getProxiedUrl(request.url));
      } catch (err) {
        return new Response('Proxy fetch failed: ' + err.message, { status: 500 });
      }
    })());
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (!response || response.status !== 200 || response.type !== 'basic') return response;
   
