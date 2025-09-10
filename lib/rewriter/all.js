const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;

function isDataOrJs(s){
  return !s || s.startsWith("data:") || s.startsWith("javascript:");
}

function resolveFullUrl(raw, base){
  try{
    if(raw.startsWith("//")) return "https:" + raw;
    if(raw.startsWith("http")) return raw;
    return new URL(raw, base).href;
  }catch(e){
    return raw;
  }
}

function proxyUrlFor(raw, proxyHost, base){
  if(isDataOrJs(raw)) return raw;
  const full = resolveFullUrl(raw, base);
  return proxyHost + "/api/proxy?url=" + encodeURIComponent(full);
}

function rewriteSrcset(value, proxyHost, base){
  return value.split(",").map(part=>{
    const p = part.trim();
    const idx = p.search(/\s/);
    const urlPart = idx === -1 ? p : p.slice(0, idx);
    const desc = idx === -1 ? "" : p.slice(idx).trim();
    if(isDataOrJs(urlPart)) return p;
    return proxyUrlFor(urlPart, proxyHost, base) + (desc ? " " + desc : "");
  }).join(", ");
}

function rewriteInlineStyle(styleVal, proxyHost, base){
  return String(styleVal).replace(/url\(([^)]+)\)/gi, (_, u)=>{
    let uu = u.replace(/['"]/g,"").trim();
    if(isDataOrJs(uu)) return "url(" + uu + ")";
    return "url(" + proxyUrlFor(uu, proxyHost, base) + ")";
  });
}

function rewriteTagAttributes(tag, proxyHost, base){
  return tag.replace(/(\b[a-zA-Z-:]+)\s*=\s*(".*?"|'.*?'|[^\s>]+)/g, (m, attr, raw)=>{
    const a = attr.toLowerCase();
    let val = raw;
    if(val[0]==="\""||val[0]==="'") val = val.slice(1, -1);
    if(a === "srcset"){
      const r = rewriteSrcset(val, proxyHost, base);
      return `${attr}="${r}"`;
    }
    if(a === "style"){
      const r = rewriteInlineStyle(val, proxyHost, base);
      return `${attr}="${r}"`;
    }
    if(["src","href","poster","action","formaction","data-src","data-href","longdesc","cite","manifest","icon","data","codebase","classid","archive"].includes(a)){
      if(isDataOrJs(val)) return m;
      return `${attr}="${proxyUrlFor(val, proxyHost, base)}"`;
    }
    if(a === "srcdoc"){
      const inner = val;
      const rewrittenInner = rewriteHTML(inner, proxyHost, base);
      const enc = rewrittenInner.replace(/"/g, "&quot;");
      return `${attr}="${enc}"`;
    }
    return m;
  });
}

function rewriteMetaRefresh(tag, proxyHost, base){
  if(!/http-equiv\s*=\s*["']?refresh["']?/i.test(tag)) return tag;
  const contentMatch = tag.match(/content\s*=\s*(".*?"|'.*?'|[^>\s]+)/i);
  if(!contentMatch) return tag;
  let content = contentMatch[1];
  if(content[0]==="\""||content[0]==="'") content = content.slice(1, -1);
  const urlMatch = content.match(/url\s*=\s*(.*)/i);
  if(!urlMatch) return tag;
  const rawUrl = urlMatch[1].trim().replace(/^["']|["']$/g,"");
  if(isDataOrJs(rawUrl)) return tag;
  const full = resolveFullUrl(rawUrl, base);
  const newContent = content.replace(urlMatch[0], "url=" + proxyHost + "/api/proxy?url=" + encodeURIComponent(full));
  return tag.replace(contentMatch[0], `content="${newContent}"`);
}

function rewriteStyleBlocks(html, proxyHost, base){
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css)=>{
    return `<style>${rewriteCSSInline(css, proxyHost, base)}</style>`;
  });
}

function rewriteCSSInline(css, proxyHost, base){
  let res = String(css).replace(/url\(([^)]+)\)/gi, (_, u)=>{
    let uu = u.replace(/['"]/g,"").trim();
    if(isDataOrJs(uu)) return `url(${uu})`;
    return `url(${proxyUrlFor(uu, proxyHost, base)})`;
  });
  res = res.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u)=>{
    if(isDataOrJs(u)) return m;
    return `@import "${proxyUrlFor(u, proxyHost, base)}"`;
  });
  return res;
}

function rewriteHTML(html, proxyHost, originalUrl){
  const baseMatch = html.match(/<base\s+[^>]*href\s*=\s*(".*?"|'.*?'|[^\s>]+)/i);
  let base = originalUrl;
  if(baseMatch){
    let b = baseMatch[1];
    if(b[0]==="\""||b[0]==="'") b = b.slice(1, -1);
    base = resolveFullUrl(b, originalUrl);
  }
  let out = String(html).replace(/<[^>]+>/g, tag=>{
    let t = tag;
    t = rewriteTagAttributes(t, proxyHost, base);
    t = rewriteMetaRefresh(t, proxyHost, base);
    return t;
  });
  out = rewriteStyleBlocks(out, proxyHost, base);
  out = out.replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi, linkTag=>{
    return linkTag.replace(/href\s*=\s*(".*?"|'.*?'|[^\s>]+)/i, (m, raw)=>{
      let v = raw;
      if(v[0]==="\""||v[0]==="'") v = v.slice(1, -1);
      if(isDataOrJs(v)) return m;
      return `href="${proxyUrlFor(v, proxyHost, base)}"`;
    });
  });
  out = out.replace(/<script\b[^>]*type\s*=\s*["']?module["']?[^>]*>\s*<\/script>/gi, s=>s);
  out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, code)=>{
    const srcMatch = attrs.match(/src\s*=\s*(".*?"|'.*?'|[^\s>]+)/i);
    if(srcMatch){
      let v = srcMatch[1];
      if(v[0]==="\""||v[0]==="'") v = v.slice(1, -1);
      if(isDataOrJs(v)) return m;
      const prox = proxyUrlFor(v, proxyHost, base);
      return `<script${attrs.replace(srcMatch[0], `src="${prox}"`)}></script>`;
    } else {
      const rewritten = rewriteJS(code, proxyHost + "/api/proxy?url=", base);
      return `<script${attrs}>${rewritten}</script>`;
    }
  });
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, s=>{
    return s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/i, (m, css)=>`<style>${rewriteCSSInline(css, proxyHost, base)}</style>`);
  });
  return out;
}

function rewriteCSS(css, proxyHost, originalUrl){
  let res = String(css).replace(/url\(([^)]+)\)/gi, (_, u)=>{
    let uu = u.replace(/['"]/g,"").trim();
    if(isDataOrJs(uu)) return `url(${uu})`;
    return `url(${proxyUrlFor(uu, proxyHost, originalUrl)})`;
  });
  res = res.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u)=>{
    if(isDataOrJs(u)) return m;
    return `@import "${proxyUrlFor(u, proxyHost, originalUrl)}"`;
  });
  res = res.replace(/@font-face([\s\S]*?){([\s\S]*?)}/gi, (match, pre, body)=>{
    const newBody = body.replace(/url\(([^)]+)\)/gi, (_, u2)=>{
      let uu2 = u2.replace(/['"]/g,"").trim();
      if(isDataOrJs(uu2)) return `url(${uu2})`;
      return `url(${proxyUrlFor(uu2, proxyHost, originalUrl)})`;
    });
    return `@font-face${pre}{${newBody}}`;
  });
  res = res.replace(/image-set\(([^)]+)\)/gi, (m, inner)=>{
    return "image-set(" + inner.replace(/url\(([^)]+)\)/gi, (_, u2)=>{
      let uu2 = u2.replace(/['"]/g,"").trim();
      if(isDataOrJs(uu2)) return `url(${uu2})`;
      return `url(${proxyUrlFor(uu2, proxyHost, originalUrl)})`;
    }) + ")";
  });
  return res;
}

function rewriteJS(jsCode, proxyPrefix, originalUrl){
  try{
    const ast = parser.parse(String(jsCode), { sourceType: "unambiguous", plugins: ["jsx","dynamicImport","classProperties","optionalChaining","bigInt","topLevelAwait"] });
    traverse(ast, {
      StringLiteral(path){
        const v = path.node.value;
        if(typeof v === "string" && (v.startsWith("http") || v.startsWith("//"))){
          path.node.value = proxyPrefix + encodeURIComponent(resolveFullUrl(v, originalUrl));
        }
      },
      TemplateLiteral(path){
        path.node.quasis.forEach(q=>{
          if(typeof q.value.raw === "string" && (q.value.raw.startsWith("http") || q.value.raw.startsWith("//"))){
            q.value.raw = proxyPrefix + encodeURIComponent(resolveFullUrl(q.value.raw, originalUrl));
            q.value.cooked = q.value.raw;
          }
        });
      },
      CallExpression(path){
        const callee = path.node.callee;
        if(callee.type === "Identifier" && callee.name === "fetch"){
          const arg = path.node.arguments[0];
          if(arg && arg.type === "StringLiteral") arg.value = proxyPrefix + encodeURIComponent(resolveFullUrl(arg.value, originalUrl));
          if(arg && arg.type === "TemplateLiteral") arg.quasis.forEach(q=>{ if(q.value.raw && (q.value.raw.startsWith("http")||q.value.raw.startsWith("//"))){ q.value.raw = proxyPrefix + encodeURIComponent(resolveFullUrl(q.value.raw, originalUrl)); q.value.cooked = q.value.raw; }});
        }
        if(callee.type === "MemberExpression" && callee.property && callee.property.name === "open"){
          const arg = path.node.arguments[1];
          if(arg && arg.type === "StringLiteral") arg.value = proxyPrefix + encodeURIComponent(resolveFullUrl(arg.value, originalUrl));
        }
      },
      NewExpression(path){
        const callee = path.node.callee;
        if(callee.type === "Identifier" && (callee.name === "WebSocket" || callee.name === "EventSource" || callee.name === "Worker" || callee.name === "SharedWorker")){
          const arg = path.node.arguments[0];
          if(arg && arg.type === "StringLiteral") arg.value = proxyPrefix + encodeURIComponent(resolveFullUrl(arg.value, originalUrl));
          if(arg && arg.type === "TemplateLiteral") arg.quasis.forEach(q=>{ if(q.value.raw && (q.value.raw.startsWith("http")||q.value.raw.startsWith("//"))){ q.value.raw = proxyPrefix + encodeURIComponent(resolveFullUrl(q.value.raw, originalUrl)); q.value.cooked = q.value.raw; }});
        }
      },
      ImportExpression(path){
        const s = path.node.source;
        if(s && s.type === "StringLiteral" && (s.value.startsWith("http")||s.value.startsWith("//"))){
          s.value = proxyPrefix + encodeURIComponent(resolveFullUrl(s.value, originalUrl));
        }
      }
    });
    return generator(ast).code;
  }catch(e){
    return jsCode;
  }
}

function rewriteAll(content, contentType, proxyHost, originalUrl){
  const ct = (contentType||"").toLowerCase();
  if(ct.includes("text/html")) return rewriteHTML(content, proxyHost, originalUrl);
  if(ct.includes("text/css")) return rewriteCSS(content, proxyHost, originalUrl);
  if(ct.includes("javascript") || ct.includes("ecmascript")) return rewriteJS(content, proxyHost + "/api/proxy?url=", originalUrl);
  return content;
}

module.exports = { rewriteHTML, rewriteCSS, rewriteJS, rewriteCSSInline, rewriteAll };
