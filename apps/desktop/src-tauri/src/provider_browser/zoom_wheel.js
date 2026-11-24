(() => {
  const native = window.chrome?.webview;
  const type = 'remoteai:browser:zoom-wheel';
  const report = step => {
    // WebView2 handles the gesture itself. At the zoom limits it emits no ZoomFactorChanged.
    if (native) native.postMessage(JSON.stringify({ type: 'browser-zoom-wheel' }));
    // WebKit's navigation delegate consumes the gesture without loading a new page.
    else location.href = step === 1 ? 'remoteai-browser-zoom:in' : 'remoteai-browser-zoom:out';
  };
  if (window === top) window.addEventListener('message', ({ source, data }) => {
    if (source !== window && source?.top === window && data?.type === type
      && (data.step === -1 || data.step === 1)) report(data.step);
  });
  window.addEventListener('wheel', event => {
    if (!event.isTrusted || !event.ctrlKey || !event.deltaY || event.defaultPrevented) return;
    if (!native) event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    if (window === top) report(step);
    else top.postMessage({ type, step }, '*');
  }, { passive: Boolean(native) });
})();
