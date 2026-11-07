// This document remains opaque and has no application IPC access.
(() => {
  const channel = __PREVIEW_NAVIGATION_CHANNEL__;
  const folder = new URL('.', location.href);
  const image = /\.(?:png|jpe?g|jfif|gif|webp|bmp|avif|svg|ico|apng)$/i;
  document.addEventListener('click', event => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const target = new URL(anchor.href);
    if (target.origin !== folder.origin || !target.pathname.startsWith(folder.pathname)
      || !image.test(decodeURIComponent(target.pathname))) return;
    event.preventDefault();
    parent.postMessage({ channel, type: 'image', url: target.href }, '*');
  });
})();
