const fetch = require("node-fetch");
const { rewriteHTML } = require("../lib/rewriter/html");
const { rewriteCSS } = require("../lib/rewriter/css");
const { rewriteJS } = require("../lib/rewriter/js");

module.exports = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter");

  try {
    let cookies = [];
    if (req.headers.cookie) {
      try {
        const match = req.headers.cookie.match(/opulent_cookies=([^;]+)/);
        if (match) cookies = JSON.parse(decodeURIComponent(match[1]));
      } catch {}
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": req.headers["user-agent"],
        "Cookie": cookies.join("; ")
      }
    });

    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();

      // Capture Set-Cookie and inject into localStorage
      const setCookie = response.headers.raw()['set-cookie'];
      if (setCookie) {
        const inject = `<script>
          localStorage.setItem("opulent_cookies", ${JSON.stringify(setCookie)});
        </script>`;
        html = inject + html;
      }

      html = rewriteHTML(html, "https://" + req.headers.host, url);
      res.end(html);
    } else if (contentType.includes("text/css")) {
      const css = await response.text();
      res.end(await rewriteCSS(css, "https://" + req.headers.host, url));
    } else if (contentType.includes("javascript") || contentType.includes("text/javascript")) {
      const js = await response.text();
      res.end(rewriteJS(js, "https://" + req.headers.host, url));
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    }
  } catch (err) {
    res.status(500).end("Proxy error: " + err.message);
  }
};