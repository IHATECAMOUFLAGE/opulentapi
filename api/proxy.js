const fetch = require("node-fetch");
const { rewriteHTML } = require("../lib/rewriter/html");
const { rewriteCSS } = require("../lib/rewriter/css");
const { rewriteJS } = require("../lib/rewriter/js");
const injectJS = require("../lib/rewriter/inject");

module.exports = async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": req.headers["user-agent"] || "OpulentAPI" }
    });

    const contentType = response.headers.get("content-type") || "";
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();
      html = `<script>${injectJS}</script>` + html;
      html = rewriteHTML(html, "https://" + req.headers.host, url);
      return res.end(html);
    }

    if (contentType.includes("text/css")) {
      const css = await response.text();
      return res.end(rewriteCSS(css, "https://" + req.headers.host, url));
    }

    if (contentType.includes("javascript") || contentType.includes("ecmascript")) {
      const js = await response.text();
      return res.end(rewriteJS(js, "https://" + req.headers.host + "/api/proxy?url=", url));
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    res.status(500).end("Proxy error: " + err.message);
  }
};
