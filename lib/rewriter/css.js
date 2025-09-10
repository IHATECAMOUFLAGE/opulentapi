const postcss = require("postcss");

function isDataOrJs(url){
  return !url || url.startsWith("data:") || url.startsWith("javascript:");
}

function resolveFullUrl(raw, base){
  try{
    if(raw.startsWith("//")) return "https:"+raw;
    if(raw.startsWith("http")) return raw;
    return new URL(raw, base).href;
  }catch(e){ return raw; }
}

function proxyUrlFor(raw, proxyHost, base){
  if(isDataOrJs(raw)) return raw;
  return proxyHost + "/api/proxy?url=" + encodeURIComponent(resolveFullUrl(raw, base));
}

function rewriteCSS(css, proxyHost, base){
  return postcss([
    root => {
      root.walkDecls(decl=>{
        decl.value = decl.value.replace(/url\(([^)]+)\)/gi, (_, u)=>{
          const clean = u.replace(/['"]/g,'').trim();
          return `url(${proxyUrlFor(clean, proxyHost, base)})`;
        });
      });
      root.walkAtRules("import", at=>{
        const m = at.params.match(/(['"])(.*?)\1/);
        if(m) at.params = `"${proxyUrlFor(m[2], proxyHost, base)}"`;
      });
    }
  ]).process(css, { from: undefined }).css;
}

module.exports = { rewriteCSS };
