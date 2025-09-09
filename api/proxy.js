const fetch = require("node-fetch");
const { parse } = require("node-html-parser");

module.exports = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": req.headers["user-agent"] }
    });

    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();
      const root = parse(html);

      root.querySelectorAll("[href],[src]").forEach(el => {
        ["href", "src"].forEach(attr => {
          const val = el.getAttribute(attr);
          if (val) {
            try {
              const newUrl = new URL(val, url).href;
              el.setAttribute(attr, "/api/proxy?url=" + encodeURIComponent(newUrl));
            } catch {}
          }
        });
      });

      res.end(root.toString());
    } else if (contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
      let js = await response.text();
      js = js.replace(/window\.location/g, `"\${req.url}"`);
      js = js.replace(/fetch\((.*?)\)/g, (m, p1) => `fetch("/api/proxy?url=" + encodeURIComponent(${p1}))`);
      res.end(js);
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    }
  } catch (err) {
    res.status(500).end("Proxy error: " + err.message);
  }
};