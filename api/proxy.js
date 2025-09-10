import axios from "axios";
import https from "https";
import * as parse5 from "parse5";
import * as postcss from "postcss";
import * as babelParser from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
import * as babelGenerator from "@babel/generator";

// --- utils ---
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

// --- CSS rewriting (async) ---
async function rewriteCSS(css, proxyHost, base) {
  const result = await postcss.default([
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
  ]).process(css, { from: undefined });
  return result.css;
}

// --- HTML rewriting ---
function rewriteAttributes(node, proxyHost, base) {
  const attrs = node.attrs || [];
  attrs.forEach(attr => {
    const name = attr.name.toLowerCase();
    if (
      [
        "src","href","poster","action","formaction","data-src","data-href",
        "longdesc","cite","manifest","icon"
      ].includes(name)
    ) {
      attr.value = proxyUrlFor(attr.value, proxyHost, base);
    }
    if (name === "style") {
      attr.value = attr.value ? attr.value.replace(/url\(([^)]+)\)/gi, (_, u) => {
        const clean = u.replace(/['"]/g, "").trim();
        return `url(${proxyUrlFor(clean, proxyHost, base)})`;
      }) : attr.value;
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

// --- JS rewriting ---
function rewriteJS(jsCode, proxyPrefix, base) {
  try {
    const ast = babelParser.parse(String(jsCode), {
      sourceType: "unambiguous",
      plugins: ["jsx", "dynamicImport", "classProperties", "optionalChaining"]
    });
    babelTraverse.default(ast, {
      StringLiteral(path) {
        const val = path.node.value;
        if (val.startsWith("http") || val.startsWith("//") || val.startsWith("./") || val.startsWith("../")) {
          path.node.value = proxyUrlFor(val, proxyPrefix, base);
        }
      },
      TemplateLiteral(path) {
        path.node.quasis.forEach(q => {
          if (q.value.cooked && (q.value.cooked.includes("http") || q.value.cooked.startsWith("//"))) {
            q.value.cooked = proxyUrlFor(q.value.cooked, proxyPrefix, base);
          }
        });
      }
    });
    return babelGenerator.default(ast).code;
  } catch {
    return jsCode;
  }
}

// --- MAIN HANDLER ---
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

  // Build proxyHost dynamically for Vercel
  const proxyHost = `${req.headers["x-forwarded-proto"]}://${req.headers.host}/api/proxy`;

  try {
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get(url, {
      httpsAgent: agent,
      responseType: "arraybuffer",
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

    const isText = /^text\/|javascript|json|xml/i.test(contentType);
    const isHtml = /text\/html/i.test(contentType);
    const isCss = /text\/css/i.test(contentType);
    const isJs = /javascript|ecmascript/i.test(contentType);

    if (!isText) {
      return res.status(response.status).send(Buffer.from(response.data));
    }

    let data = Buffer.from(response.data).toString("utf8");

    if (isHtml) {
      data = rewriteHTML(data, proxyHost, url);
    } else if (isCss) {
      data = await rewriteCSS(data, proxyHost, url);
    } else if (isJs) {
      data = rewriteJS(data, `${proxyHost}?url=`, url);
    }

    return res.status(response.status).send(data);
  } catch (err) {
    return res.status(500).send(`<h1>Proxy Error</h1><p>${err.message}</p>`);
  }
}
