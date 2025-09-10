const fetch = require("node-fetch");
const parse5 = require("parse5");
const postcss = require("postcss");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const fs = require("fs");
const path = require("path");

let injectJS = "";
try {
  injectJS = fs.readFileSync(path.join(__dirname, "../lib/rewriter/inject.js"), "utf8");
} catch (e) {}

function isDataOrJs(url) {
  return !url || url.startsWith("data:") || url.startsWith("javascript:");
}

function resolveFullUrl(raw, base) {
  try {
    if(raw.startsWith("//")) return "https:" + raw;
    if(raw.startsWith("http")) return raw;
    return new URL(raw, base).href;
  } catch(e){ return raw; }
}

function proxyUrlFor(raw, proxyPrefix, base) {
  if(isDataOrJs(raw)) return raw;
  const resolved = resolveFullUrl(raw, base);
  if(resolved.startsWith(proxyPrefix)) return resolved;
  return proxyPrefix + encodeURIComponent(resolved);
}

function rewriteCSS(css, proxyPrefix, base) {
  return postcss([
    root => {
      root.walkDecls(decl => {
        decl.value = decl.value.replace(/url\(([^)]+)\)/gi, (_, u) => {
          const clean = u.replace(/['"]/g,'').trim();
          return `url(${proxyUrlFor(clean, proxyPrefix, base)})`;
        });
      });
      root.walkAtRules("import", at => {
        const m = at.params.match(/(['"])(.*?)\1/);
        if(m) at.params = `"${proxyUrlFor(m[2], proxyPrefix, base)}"`;
      });
    }
  ]).process(css, { from: undefined }).css;
}

function rewriteAttributes(node, proxyPrefix, base) {
  const attrs = node.attrs || [];
  attrs.forEach(attr => {
    const name = attr.name.toLowerCase();
    if(["src","href","poster","action","formaction","data-src","data-href","longdesc","cite","manifest","icon"].includes(name)){
      attr.value = proxyUrlFor(attr.value, proxyPrefix, base);
    }
    if(name === "style"){
      attr.value = rewriteCSS(attr.value, proxyPrefix, base);
    }
  });
}

function walk(node, proxyPrefix, base) {
  if(node.nodeName === "#text") return;
  if(node.attrs) rewriteAttributes(node, proxyPrefix, base);
  if(node.childNodes) node.childNodes.forEach(c => walk(c, proxyPrefix, base));
}

function rewriteHTML(html, proxyPrefix, base) {
  const doc = parse5.parse(html);
  walk(doc, proxyPrefix, base);
  return parse5.serialize(doc);
}

function rewriteJS(jsCode, proxyPrefix, base) {
  try{
    const ast = parser.parse(String(jsCode), { sourceType:"unambiguous", plugins:["jsx","dynamicImport","classProperties","optionalChaining"] });
    traverse(ast, {
      StringLiteral(path){
        if(path.node.value.startsWith("http") || path.node.value.startsWith("//") || path.node.value.startsWith("./") || path.node.value.startsWith("../")){
          path.node.value = proxyUrlFor(path.node.value, proxyPrefix, base);
        }
      }
    });
    return generator(ast).code;
  } catch(e){ return jsCode; }
}

module.exports = async (req, res) => {
  const url = req.query.url;
  if(!url) return res.status(400).send("Missing ?url parameter");

  const proxyPrefix = `https://${req.headers.host}/api/proxy?url=`;

  let response;
  try{
    response = await fetch(url, {
      headers: { "User-Agent": req.headers["user-agent"] || "OpulentAPI" }
    });
  } catch(e){
    return res.status(500).send("Fetch error: "+e.message);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  res.setHeader("Content-Type", contentType);

  try{
    if(contentType.includes("text/html")){
      let html = await response.text();
      if(injectJS) html = html.replace(/<\/head>/i, `<script>${injectJS}</script></head>`);
      html = rewriteHTML(html, proxyPrefix, url);
      return res.end(html);
    }

    if(contentType.includes("text/css")){
      const css = await response.text();
      return res.end(rewriteCSS(css, proxyPrefix, url));
    }

    if(contentType.includes("javascript") || contentType.includes("ecmascript")){
      const js = await response.text();
      return res.end(rewriteJS(js, proxyPrefix, url));
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch(e){
    return res.status(500).send("Rewrite error: "+e.message);
  }
};
