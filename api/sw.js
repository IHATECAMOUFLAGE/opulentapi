const proxyBase = self.registration.scope + 'api/proxy?url=';

function proxify(url) {
  try {
    if (url.startsWith(proxyBase)) return url;
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('mailto:')) return url;
    const absolute = new URL(url, location.href).toString();
    return proxyBase + encodeURIComponent(absolute);
  } catch (e) {
    return url;
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === location.origin && url.pathname.startsWith('/api/proxy')) {
    return; 
  }

  const proxiedUrl = proxify(request.url);

  event.respondWith(
    caches.open('proxy-cache-v1').then(async (cache) => {
      try {
        const cached = await cache.match(proxiedUrl);
        if (cached) return cached;
        const response = await fetch(proxiedUrl, { headers: { 'X-Proxy': 'true' } });
        if (response.ok && response.type === 'basic') {
          cache.put(proxiedUrl, response.clone());
        }
        return response;
      } catch (e) {
        return new Response('Proxy fetch failed: ' + e.message, { status: 502 });
      }
    })
  );
});
