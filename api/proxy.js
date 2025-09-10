import axios from "axios";
import https from "https";
import fs from "fs";
import path from "path";
import * as parse5 from "parse5";
import * as postcss from "postcss";
import * as babelParser from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
import * as babelGenerator from "@babel/generator";

function isDataOrJs(url) {
  return !url || url.startsWith("data:") || url.startsWith("javascript:");
}

function resolveFullUrl(raw, base) {
  try {
    if (raw.startsWith("//")) return "https:" + raw;
    if (raw.startsWith("http")) return raw;
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

function proxyUrlFor(raw, proxyHost, base) {
  if (isDataOrJs(raw)) return raw;
  return `${proxyHost}?url=${encodeURIComponent(resolveFullUrl(raw, base))}`;
}

function rewriteCSS(css, proxyHost, base) {
  return postcss.default([
    root => {
      root.walkDecls(decl => {
        decl.value = decl.value.replace(/url\(([^)]+)\)/gi, (_, u) => {
          const clean = u.replace(/['"]/g, "").trim();
          return `url(${proxyUrlFor(clean, proxyHost, base)})`;
        });
      });
      root.walkAtRules("import", at => {
        const m = at.params.match(/(['"])(.*?)\1/);
        if (m) at.params = `"${proxyUrlFor(m[2], proxyHost, base)}"`;
      });
    }
  ]).process(css, { from: undefined }).css;
}

function rewriteAttributes(node, proxyHost, base) {
  const attrs = node.attrs || [];
  attrs.forEach(attr => {
    const name = attr.name.toLowerCase();
    if (["src","href","poster","action","formaction","data-src","data-href","longdesc","cite","manifest","icon"].includes(name)) {
      attr.value = proxyUrlFor(attr.value, proxyHost, base);
    }
    if (name === "style") {
      attr.value = rewriteCSS(attr.value, proxyHost, base);
    }
  });
}

function walk(node, proxyHost, base) {
  if (node.nodeName === "#text") return;
  if (node.attrs) rewriteAttributes(node, proxyHost, base);
  if (node.childNodes) node.childNodes.forEach(c => walk(c, proxyHost, base));
}

function rewriteHTML(html, proxyHost, base) {
  const doc = parse5.parse(html);
  walk(doc, proxyHost, base);
  return parse5.serialize(doc);
}

function rewriteJS(jsCode, proxyPrefix, base) {
  try {
    const ast = babelParser.parse(String(jsCode), {
      sourceType: "unambiguous",
      plugins: ["jsx", "dynamicImport", "classProperties", "optionalChaining"]
    });
    babelTraverse.default(ast, {
      StringLiteral(path) {
        if (path.node.value.startsWith("http") || path.node.value.startsWith("//") || path.node.value.startsWith("./") || path.node.value.startsWith("../")) {
          path.node.value = proxyUrlFor(path.node.value, proxyPrefix, base);
        }
      }
    });
    return babelGenerator.default(ast).code;
  } catch {
    return jsCode;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, User-Agent, Referer");
    return res.status(204).end();
  }

  let { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter.");
  url = decodeURIComponent(url);

  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url);
    const isBinary = /\.(woff2?|ttf|eot|otf|ico)$/i.test(url);
    const isJson = /\.json$/i.test(url);
    const isJs = /\.js$/i.test(url);

    const response = await axios.get(url, {
      httpsAgent: agent,
      responseType: isImage || isBinary ? "arraybuffer" : "text",
      timeout: 30000,
      headers: {
        "User-Agent": req.headers["user-agent"] || "",
        "Accept": "*/*"
      }
    });

    const contentType = response.headers["content-type"] || "application/octet-stream";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);

    const headers = { ...response.headers };
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    delete headers["x-frame-options"];
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);

    if (isImage || isBinary) return res.status(response.status).send(Buffer.from(response.data));
    if (isJson) return res.status(response.status).json(response.data);

    let data = response.data;

    if (contentType.includes("text/html")) {
      data = rewriteHTML(data, `/api/proxy`, url);
    } else if (contentType.includes("text/css")) {
      data = rewriteCSS(data, `/api/proxy`, url);
    } else if (isJs || contentType.includes("javascript") || contentType.includes("ecmascript")) {
      data = rewriteJS(data, `/api/proxy?url=`, url);
    }

    return res.status(response.status).send(data);
  } catch (err) {
    return res.status(500).send(`<h1>Proxy Error</h1><p>${err.message}</p>`);
  }
}
