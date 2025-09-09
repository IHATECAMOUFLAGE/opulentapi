self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (!url.pathname.startsWith('/api/proxy')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => response)
      .catch(() => new Response("Proxy fetch failed", { status: 500 }))
  );
});