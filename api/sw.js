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

self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method === 'GET') {
    const proxiedUrl = proxify(request.url);
    event.respondWith(caches.open('proxy-cache-v1').then(async cache => {
      try {
        const cached = await cache.match(proxiedUrl);
        if (cached) return cached;
        const response = await fetch(proxiedUrl, { headers: { 'X-Proxy': 'true' } });
        if (response.ok && response.type === 'basic') cache.put(proxiedUrl, response.clone());
        return response;
      } catch (e) {
        return new Response('Proxy fetch failed: ' + e.message, { status: 502 });
      }
    }));
    return;
  }

  if (request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const contentType = request.headers.get('Content-Type') || '';
        let body;

        if (contentType.includes('application/json')) {
          body = await request.clone().json();
          body = JSON.stringify(body);
        } else {
          const formData = await request.clone().formData();
          const params = new URLSearchParams();
          for (const [key, value] of formData) params.append(key, value);
          body = params.toString();
        }

        const proxiedUrl = proxify(request.url);

        const response = await fetch(proxiedUrl, {
          method: 'POST',
          body,
          headers: { 'Content-Type': contentType || 'application/x-www-form-urlencoded', 'X-Proxy': 'true' },
          redirect: 'manual'
        });

        if (response.status >= 300 && response.status < 400 && response.headers.get('Location')) {
          const location = response.headers.get('Location');
          const proxiedLocation = proxify(location);
          return Response.redirect(proxiedLocation, 302);
        }

        return response;
      } catch (e) {
        return new Response('Proxy POST failed: ' + e.message, { status: 502 });
      }
    })());
  }
});
