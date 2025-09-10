self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const proxyHost = self.location.origin + '/api/proxy?url=';
  let target = e.request.url;
  if(!url.pathname.startsWith('/api/')) target = proxyHost + encodeURIComponent(e.request.url);
  e.respondWith(
    fetch(target, {
      headers: e.request.headers,
      method: e.request.method,
      body: e.request.body,
      credentials: 'same-origin'
    }).catch(() => fetch(e.request))
  );
});
