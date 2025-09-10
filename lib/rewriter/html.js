const parse5 = require("parse5");
const { rewriteCSS } = require("./css");

function isDataOrJs(url){
  return !url || url.startsWith("data:") || url.startsWith("javascript:");
}

function resolveFullUrl(raw, base){
  try {
    if(raw.startsWith("//")) return "https:" + raw;
    if(raw.startsWith("http")) return raw;
    return new URL(raw, base).href;
  } catch(e){ return raw; }
}

function proxyUrlFor(raw, proxyHost, base){
  if(isDataOrJs(raw)) return raw;
  return proxyHost + "/api/proxy?url=" + encodeURIComponent(resolveFullUrl(raw, base));
}

function rewriteAttributes(node, proxyHost, base){
  const attrs = node.attrs || [];
  attrs.forEach(attr=>{
    const name = attr.name.toLowerCase();
    if(["src","href","poster","action","formaction","data-src","data-href","longdesc","cite","manifest","icon"].includes(name)){
      attr.value = proxyUrlFor(attr.value, proxyHost, base);
    }
    if(name === "style"){
      attr.value = rewriteCSS(attr.value, proxyHost, base);
    }
  });
}

function walk(node, proxyHost, base){
  if(node.nodeName === "#text") return;
  if(node.attrs) rewriteAttributes(node, proxyHost, base);
  if(node.childNodes) node.childNodes.forEach(c=>walk(c, proxyHost, base));
}

function rewriteHTML(html, proxyHost, baseUrl){
  const doc = parse5.parse(html);
  walk(doc, proxyHost, baseUrl);
  return parse5.serialize(doc);
}

module.exports = { rewriteHTML };
