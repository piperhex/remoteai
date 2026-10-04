import { css } from '../../assets/math-css.json';
import { script as textSelectionScript } from '../../assets/text-selection.json';

export const MIN_MATH_HEIGHT = 32;
const MAX_MATH_HEIGHT = 10000;

export interface MathTextOptions { muted?: boolean; fontSize?: number }

export function mathDocument(markup: string, options: MathTextOptions = {}): string {
  const fontSize = options.fontSize ?? 14;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:;
style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>${css}
html,body{margin:0;padding:0;background:transparent;color:${options.muted ? '#718078' : '#17211b'};}
body{font:${fontSize}px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
#content{padding:4px 0;overflow-x:auto;overflow-y:hidden;overflow-wrap:anywhere;}
.katex{white-space:normal;overflow-wrap:normal;}.katex-display{margin:0;}
a{color:#0b8065;}code{background:#f4f6f5;}
</style></head><body><div id="content">${markup}</div><script>
(()=>{
const content=document.getElementById('content');
${textSelectionScript}
let previous=0;
function measure(){
  const height=Math.ceil(content.getBoundingClientRect().height);
  if(height!==previous){previous=height;window.ReactNativeWebView?.postMessage(JSON.stringify({height}));}
}
new ResizeObserver(measure).observe(content);
document.fonts.ready.then(measure);
window.addEventListener('load',measure);
measure();
})();
</script></body></html>`;
}

export function mathHeight(message: string): number | null {
  try {
    const value: unknown = JSON.parse(message);
    if (!value || typeof value !== 'object' || !('height' in value)) return null;
    const height = value.height;
    return typeof height === 'number' && Number.isFinite(height) && height > 0
      ? Math.max(MIN_MATH_HEIGHT, Math.min(MAX_MATH_HEIGHT, Math.ceil(height))) : null;
  } catch { return null; }
}
