import http from 'node:http';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Navigation test</title>
<style>body{font:16px system-ui;padding:32px;color:#23372f;background:#fafbfc}
button,input{font:inherit;margin:6px;padding:8px}output{display:block;margin:24px 0;overflow-wrap:anywhere}</style>
</head><body><h1>Same-document navigation</h1><p>The page and draft stay loaded while the address changes.</p>
<button id="push">Push path</button><button id="replace">Replace path</button><button id="hash">Change hash</button>
<button id="frame">Change frame path</button><button id="invalid">Invalid origin</button>
<output></output><label>Draft <input aria-label="Draft" value="original"></label>
<iframe src="/frame" title="Nested frame" style="display:none"></iframe>
<script>
const show = () => document.querySelector('output').textContent = location.pathname + location.search + location.hash;
document.querySelector('#push').onclick = () => { history.pushState({step:1}, '', '/spa/pushed?view=1'); show(); };
document.querySelector('#replace').onclick = () => { history.replaceState({step:2}, '', '/spa/replaced?view=2'); show(); };
document.querySelector('#hash').onclick = () => { location.hash = 'details'; };
document.querySelector('#frame').onclick = () => {
  document.querySelector('iframe').contentWindow.history.pushState({}, '', '/frame/changed');
};
document.querySelector('#invalid').onclick = () => {
  try { history.pushState({}, '', 'https://invalid.example/'); } catch (error) { window.navigationError = error.name; }
};
addEventListener('popstate', show); addEventListener('hashchange', show); show();
</script></body></html>`;

export async function navigationFixture(port) {
  const pending = new Set();
  let continueCapture;
  const server = http.createServer((request, response) => {
    if (request.url === '/continue') { continueCapture?.(); response.end('ok'); return; }
    if (request.url === '/pending-image') {
      pending.add(response); response.on('close', () => pending.delete(response)); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (request.url === '/frame') { response.end('<p>Nested frame</p>'); return; }
    response.end(request.url === '/slow' ? html.replace('</body>', '<img src="/pending-image"></body>') : html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', resolve);
  });
  return {
    pending,
    release: () => { for (const response of pending) response.end(); },
    capture: async label => {
      console.log(`Screenshot ready: ${label}`);
      if (process.env.BROWSER_NAVIGATION_PAUSE?.split(',').includes(label)) {
        await new Promise(resolve => { continueCapture = resolve; });
        continueCapture = undefined;
      }
    },
    close: () => { server.closeAllConnections(); server.close(); },
  };
}
