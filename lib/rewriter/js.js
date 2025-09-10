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
  }catch(e){ return raw; }
}

function proxyUrlFor(raw, proxyPrefix, base){
  if(isDataOrJs(raw)) return raw;
  return proxyPrefix + encodeURIComponent(resolveFullUrl(raw, base));
}

function rewriteJS(jsCode, proxyPrefix, baseUrl){
  try{
    const ast = parser.parse(String(jsCode), { sourceType: "unambiguous", plugins: ["jsx","dynamicImport","classProperties","optionalChaining"] });
    traverse(ast, {
      StringLiteral(path){
        if(path.node.value.startsWith("http") || path.node.value.startsWith("//")){
          path.node.value = proxyUrlFor(path.node.value, proxyPrefix, baseUrl);
        }
      }
    });
    return generator(ast).code;
  }catch(e){ return jsCode; }
}

module.exports = { rewriteJS };
