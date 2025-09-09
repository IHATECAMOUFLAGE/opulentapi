let parse5;
(async () => {
  parse5 = (await import('parse5')).default;
})();

function walk(node, proxyOrigin, targetOrigin) {
  if (node.attrs) {
    node.attrs.forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (['href','src','action','data'].includes(name) && value && !value.startsWith('data:') && !value.startsWith('javascript:')) {
        attr.value = proxyOrigin + '/api/proxy?url=' + encodeURIComponent(new URL(value, targetOrigin).href);
      }
      if (name === 'http-equiv' && value.toLowerCase() === 'refresh') {
        const contentAttr = node.attrs.find(a => a.name.toLowerCase() === 'content');
        if (contentAttr) {
          const match = contentAttr.value.match(/url=(.+)/i);
          if (match) {
            contentAttr.value = 'url=' + proxyOrigin + '/api/proxy?url=' + encodeURIComponent(new URL(match[1], targetOrigin).href);
          }
        }
      }
    });
  }
  if (node.childNodes) node.childNodes.forEach(n => walk(n, proxyOrigin, targetOrigin));
}

function rewriteHTML(html, proxyOrigin, targetOrigin) {
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
  walk(doc, proxyOrigin, targetOrigin);
  return parse5.serialize(doc);
}

module.exports = { rewriteHTML };
