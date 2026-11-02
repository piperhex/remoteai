import http from 'node:http';

const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1:1553').pathname;
  const name = path.split('/').at(-1) || 'guide';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>${name} · Remote AI</title></head>
    <body style="font:16px system-ui;padding:32px;background:#fafbfc;color:#23372f">
    <h1>${name}</h1><p>Remote AI · 浏览器预览验证</p>
    <form onsubmit="event.preventDefault();document.querySelector('#result').textContent='已提交'">
    <label>备注 <input name="note" aria-label="备注"></label>
    <label>类型 <select aria-label="类型"><option value="a">指南</option><option value="b">项目</option></select></label>
    <button type="submit">提交</button></form><p id="result"></p>
    <button onclick="this.textContent='完成'">确认</button>
    <p><a href="/preview-site/next">下一页</a> <a href="/preview-site/popup" target="_blank">新窗口</a></p>
    <div style="height:1400px;border-top:1px solid #ddd;margin-top:30px">滚动验证</div></body></html>`);
});
server.listen(1553, '127.0.0.1');
