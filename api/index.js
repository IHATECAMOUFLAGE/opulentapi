export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html");
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>OpulentAPI</title>
    </head>
    <body>
      <h1>OpulentAPI</h1>
      <form id="proxyForm">
        <input type="text" id="url" placeholder="Enter a URL" />
        <button type="submit">Go</button>
      </form>
      <script>
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/api/sw.js');
        }

        document.getElementById("proxyForm").addEventListener("submit", e => {
          e.preventDefault();
          const target = document.getElementById("url").value;
          window.location.href = "/api/proxy?url=" + encodeURIComponent(target);
        });
      </script>
    </body>
    </html>
  `);
}