(() => {
  if (window.top !== window) return;
  // Wry's WebMessageReceived handler expects the same string envelope as password messages.
  const send = type => window.chrome?.webview?.postMessage(JSON.stringify({ type }));
  const dismiss = () => send('browser-overlay-dismiss');
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismiss();
    if (event.key === 'ArrowDown' && !event.altKey && !event.ctrlKey && !event.metaKey
      && event.target instanceof HTMLInputElement && event.target.form) {
      send('browser-overlay-focus');
    }
  }, true);
  window.addEventListener('pagehide', dismiss);
})();
