// Executed with the verified top-level WebView2 error document as "this".
async function certificateInterstitial() {
  if (this.documentURI !== 'chrome-error://chromewebdata/') return null;
  if (this.readyState === 'loading') {
    await new Promise(resolve => this.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const data = this.defaultView.loadTimeData?.data_;
  const paragraph = this.querySelector('#details #final-paragraph');
  const proceed = paragraph?.querySelector('#proceed-link');
  if (data?.type !== 'SSL' || data.overridable !== true || !proceed || !data.pem || !data.errorCode) return null;
  return {
    pem: data.pem, reason: data.errorCode,
    proceed() { if (proceed.isConnected && data.overridable === true) proceed.click(); },
    prompt(options) {
      const note = document.createElement('p');
      note.textContent = options.changed ? options.copy.changed : options.copy.remember;
      const fingerprint = document.createElement('code');
      fingerprint.style.cssText = 'display:block;font:0.9em/1.55 ui-monospace,monospace;overflow-wrap:anywhere';
      fingerprint.append('SHA-256');
      const bytes = options.fingerprint.match(/../g);
      for (const start of [0, 16]) {
        const row = document.createElement('span');
        row.style.display = 'block';
        row.textContent = bytes.slice(start, start + 16).join(':') + (start === 0 ? ':' : '');
        fingerprint.append(row);
      }
      paragraph.before(note, fingerprint);
      proceed.textContent = options.copy.trust;
      return new Promise(resolve => {
        const choose = event => {
          if (!event.isTrusted || !proceed.contains(event.target)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          document.removeEventListener('click', choose, true);
          resolve(true);
        };
        document.addEventListener('click', choose, true);
        window.addEventListener('pagehide', () => resolve(false), { once: true });
      });
    },
  };
}
