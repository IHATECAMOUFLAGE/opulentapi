import fetch from "node-fetch";
import { parse } from "node-html-parser";

export default async function handler(req, res) {
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

      // Rewrite <a href>
      root.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href");
        if (href) {
          try {
            const newUrl = new URL(href, url).href;
            a.setAttribute("href", "/api/proxy?url=" + encodeURIComponent(newUrl));
          } catch {}
        }
      });

      // Rewrite <img>, <script>, <link>
      root.querySelectorAll("[src],[href]").forEach(el => {
        ["src", "href"].forEach(attr => {
          const val = el.getAttribute(attr);
          if (val) {
            try {
              const newUrl = new URL(val, url).href;
              el.setAttribute(attr, "/api/proxy?url=" + encodeURIComponent(newUrl));
            } catch {}
          }
        });
      });

      res.send(root.toString());
    } else {
      // Non-HTML: stream file
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    }
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
