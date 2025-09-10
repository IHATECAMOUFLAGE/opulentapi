const swScript = `
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const proxyHost = self.location.origin + '/api/proxy?url=';

  let target = event.request.url;

  if (!url.pathname.startsWith('/api/')) {
    target = proxyHost + encodeURIComponent(event.request.url);
  }

  event.respondWith(
    fetch(target, {
      headers: event.request.headers,
      method: event.request.method,
      body: event.request.body,
      mode: 'cors',
      credentials: 'same-origin'
    }).catch(() => fetch(event.request))
  );
});
`;

module.exports = swScript;
