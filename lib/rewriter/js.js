const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;

function rewriteJS(jsCode, proxyPrefix){
  try{
    const ast = parser.parse(jsCode, {sourceType: "unambiguous", plugins:["jsx","classProperties","optionalChaining"]});
    traverse(ast,{
      StringLiteral(path){
        const val = path.node.value;
        if(val.startsWith("http")) path.node.value = proxyPrefix+encodeURIComponent(val);
      },
      TemplateLiteral(path){
        path.node.quasis.forEach(q=>{
          if(q.value.raw.startsWith("http")) q.value.raw = proxyPrefix+encodeURIComponent(q.value.raw);
        });
      }
    });
    return generator(ast).code;
  }catch(e){
    return jsCode;
  }
}

module.exports = { rewriteJS };
