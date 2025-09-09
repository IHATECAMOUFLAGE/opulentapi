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

      root.querySelectorAll("script").forEach(script => {
        if (script.innerHTML) {
          let code = script.innerHTML;
          code = code.replace(/window\.location/g, `"\${req.url}"`);
          code = code.replace(/fetch\((.*?)\)/g, (m, p1) => `fetch("/api/proxy?url=" + encodeURIComponent(${p1}))`);
          code = code.replace(/XMLHttpRequest\.open\((['"])(GET|POST)(['"]),\s*(.*?)\)/g, (m, q1, method, q2, urlArg) => 
            `open(${q1}${method}${q2}, "/api/proxy?url=" + encodeURIComponent(${urlArg}))`
          );
          script.set_content(code);
        }
      });

      res.send(root.toString());
    } else if (contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
      let js = await response.text();
      js = js.replace(/window\.location/g, `"\${req.url}"`);
      js = js.replace(/fetch\((.*?)\)/g, (m, p1) => `fetch("/api/proxy?url=" + encodeURIComponent(${p1}))`);
      res.send(js);
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    }

  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}