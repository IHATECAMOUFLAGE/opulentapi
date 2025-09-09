function rewriteHTML(html, proxyHost, originalUrl){
  return html.replace(/(href|src|poster|data-src|srcset)=["']([^"']+)["']/gi,
    (match, attr, url) => {
      if(url.startsWith("http") || url.startsWith("//")){
        const fullUrl = url.startsWith("//") ? "https:" + url : url;
        return `${attr}="${proxyHost}/api/proxy?url=${encodeURIComponent(fullUrl)}"`;
      }
      return match;
    }
  );
}

module.exports = { rewriteHTML };
