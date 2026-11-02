/** Deterministic remote files used by browser and physical-device preview regression tests. */
export const HTML_FIXTURE_PATH = 'F:/preview test/页面/index.html';
export const HTML_FIXTURE_DOCUMENT = '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<link rel="stylesheet" href="styles/report.css"></head><body><h1>相对资源预览</h1>'
  + '<p id="loaded">正在读取图片</p><a href="images/preview%20image.svg" target="_blank">'
  + '<img id="photo" src="images/preview%20image.svg" alt="相邻图片"></a>'
  + '<button onclick="this.textContent=\'已点击\'">保留预览状态</button>'
  + '<script src="scripts/report.js"></script></body></html>';
export const HTML_FIXTURE_ASSETS: Record<string, { text: string; mime: string }> = {
  'styles/report.css': { mime: 'text/css', text: 'body{font:16px/1.6 system-ui;margin:20px;color:#17382c;'
    + 'background:#f5f7f6}h1{font-size:24px}img{display:block;width:100%;max-width:720px;border-radius:12px;'
    + 'margin:18px 0}button{padding:12px 24px;background:#0b8065;color:white;border:0;border-radius:10px}' },
  'images/preview image.svg': { mime: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"'
    + ' width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" rx="20" fill="#d8eee4"/>'
    + '<circle cx="320" cy="150" r="60" fill="#0b8065"/><path d="m290 150 20 20 40-40" fill="none"'
    + ' stroke="white" stroke-width="10"/><text x="320" y="265" text-anchor="middle" fill="#17382c"'
    + ' font-size="28" font-family="sans-serif">HTML + CSS + Image</text></svg>' },
  'scripts/report.js': { mime: 'text/javascript', text: 'window.addEventListener("load",()=>{'
    + 'document.querySelector("#loaded").textContent=document.querySelector("#photo").naturalWidth>0'
    + '?"资源加载成功":"图片未就绪";document.body.dataset.isolated=String(!window.ReactNativeWebView);});' },
};
