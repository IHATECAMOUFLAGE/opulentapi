const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const { rewriteHTML } = require("../lib/rewriter/html");
const { rewriteCSS } = require("../lib/rewriter/css");
const { rewriteJS } = require("../lib/rewriter/js");

let injectJS = "";
try {
  injectJS = fs.readFileSync(path.join(__dirname, "../lib/rewriter/inject.js"), "utf8");
} catch (e) {}

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing ?url parameter");

  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": req.headers["user-agent"] || "OpulentAPI" }
    });
  } catch (e) {
    return res.status(500).send("Fetch error: " + e.message);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  res.setHeader("Content-Type", contentType);

  try {
    if (contentType.includes("text/html")) {
      let html = await response.text();
      if (injectJS) {
        html = html.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
      }
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

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (e) {
    return res.status(500).send("Rewrite error: " + e.message);
  }
};
