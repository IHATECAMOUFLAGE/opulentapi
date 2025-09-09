const postcss = require('postcss');
const valueParser = require('postcss-value-parser');

async function rewriteCSS(css, proxyOrigin, targetOrigin) {
  const root = postcss.parse(css);

  root.walkDecls(decl => {
    const parsed = valueParser(decl.value);
    parsed.walk(node => {
      if (node.type === 'function' && node.value === 'url' && node.nodes[0]) {
        const url = node.nodes[0].value;
        if (!url.startsWith('data:')) {
          node.nodes[0].value = proxyOrigin + '/api/proxy?url=' + encodeURIComponent(new URL(url, targetOrigin).href);
        }
      }
    });
    decl.value = parsed.toString();
  });

  root.walkAtRules('import', rule => {
    const parsed = valueParser(rule.params);
    parsed.walk(node => {
      if (node.type === 'string' || (node.type === 'function' && node.value === 'url')) {
        const url = node.type === 'string' ? node.value : node.nodes[0].value;
        if (!url.startsWith('data:')) {
          const proxied = proxyOrigin + '/api/proxy?url=' + encodeURIComponent(new URL(url, targetOrigin).href);
          if (node.type === 'string') node.value = proxied;
          else node.nodes[0].value = proxied;
        }
      }
    });
    rule.params = parsed.toString();
  });

  return root.toString();
}

module.exports = { rewriteCSS };