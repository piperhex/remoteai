// External classic script: installed before page scripts under the desktop's strict content policy.
(() => {
  const channel = document.currentScript?.dataset.channel;
  const images = new Set();
  const media = new Set();
  const updates = new Set();
  let failed = false;
  let documentLoaded = false;
  let resourcesLoaded = false;
  let notified = false;

  function notifyLoaded() {
    if (!documentLoaded || !resourcesLoaded || notified) return;
    notified = true;
    window.removeEventListener('load', deferLoad, true);
    // Retain one window load notification, after deferred images have usable dimensions.
    queueMicrotask(() => window.dispatchEvent(new Event('load')));
  }

  function deferLoad(event) {
    if (event.target !== document && event.target !== window) return;
    event.stopImmediatePropagation();
    documentLoaded = true;
    notifyLoaded();
  }

  async function complete() {
    await Promise.all([...updates]);
    for (const element of media) {
      if (!element.currentSrc) element.load();
    }
    // A failed image still releases load, just as a normal document does after an image error.
    await Promise.all([...images].map(image => image.decode().catch(() => undefined)));
    resourcesLoaded = true;
    notifyLoaded();
    parent.postMessage({ channel, type: 'loaded', failed }, '*');
  }

  async function update({ id, attribute, value }) {
    if (!['src', 'poster', 'srcset', 'css'].includes(attribute) || typeof id !== 'string'
      || !/^\d+$/.test(id) || typeof value !== 'string') return;
    if (attribute === 'css') {
      document.documentElement.style.setProperty(`--preview-${channel}-${id}`, `url(${JSON.stringify(value)})`);
      const image = new Image(); image.src = value; images.add(image);
      return;
    }
    const marker = `data-preview-${attribute}`;
    for (const element of document.querySelectorAll(`[${marker}="${id}"]`)) {
      if (element instanceof HTMLImageElement) {
        const image = new Image();
        if (attribute === 'srcset') {
          image.sizes = element.getAttribute('sizes') ?? ''; image.srcset = value;
        } else image.src = value;
        // Keep the valid loading image visible until decoding finishes, including slow HTTP images.
        await image.decode().catch(() => { failed = true; });
      }
      // Preserve selections made by page scripts while the initial resource was still loading.
      const placeholder = element.getAttribute('data-preview-placeholder');
      if (!element.hasAttribute(attribute) || attribute === 'src' && element.getAttribute('src') === placeholder) {
        element.setAttribute(attribute, value);
      }
      element.removeAttribute(marker);
      if (element instanceof HTMLImageElement) {
        images.add(element);
        void element.decode().catch(() => undefined).then(() => {
          element.removeAttribute('aria-busy'); element.removeAttribute('data-preview-placeholder');
        });
      }
      const parentImage = element.parentElement?.querySelector('img');
      if (element.tagName === 'SOURCE' && parentImage) images.add(parentImage);
      if (element.tagName === 'SOURCE' && element.parentElement instanceof HTMLMediaElement) {
        // Select once after all alternatives arrive, without restarting an already playing video.
        media.add(element.parentElement);
      }
    }
  }

  window.addEventListener('load', deferLoad, true);
  window.addEventListener('message', event => {
    if (!channel || event.source !== parent || event.data?.channel !== channel) return;
    if (event.data.type === 'complete') void complete();
    else {
      const pending = update(event.data);
      updates.add(pending);
      void pending.finally(() => updates.delete(pending));
    }
  });
  document.addEventListener('DOMContentLoaded', () => parent.postMessage({ channel, type: 'ready' }, '*'),
    { once: true });
})();
