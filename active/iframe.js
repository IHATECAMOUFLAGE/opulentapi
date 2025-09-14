"use strict";
let destination = "";

// Extract the destination URL from the hash
try {
  destination = new URL(location.hash.slice(1)).toString();
} catch (err) {
  alert(`Bad # string or bad URL. Got error:\n${err}`);
  throw err;
}

// Register the service worker
registerSW()
  .then(() => {
    // Hide the loader container once the URL is ready to be loaded
    document.querySelector('.loader-container').style.display = 'none';

    // Use UV's encodeUrl function to encode the destination
    const encodedUrl = __uv$config.prefix + __uv$config.encodeUrl(destination);

    // Create and insert the iframe dynamically
    const iframe = document.createElement('iframe');
    iframe.src = encodedUrl;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    // Send a message to the iframe once it's loaded, telling it to inject Eruda
    iframe.onload = () => {
      // Send a message to the iframe's contentWindow
      iframe.contentWindow.postMessage({ action: 'injectEruda' }, '*');
    };

  })
  .catch((err) => {
    alert(`Encountered error:\n${err}`);
  });
