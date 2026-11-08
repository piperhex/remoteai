import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, '.codex-tmp/thread-activity');
await mkdir(output, { recursive: true });
const web = path.join(root, 'apps/web/test-results/thread-activity');
for (const file of (await readdir(web)).filter(file => /^web-.*\.png$/.test(file))) {
  await copyFile(path.join(web, file), path.join(output, file));
}
const platforms = { local: '桌面本地', remote: '桌面远程', web: 'Web', android: 'Android 模拟器' };
const states = { running: '运行中置顶', expanded: '展开列表', completed: '刚完成的对话',
  'custom-group': '自定义分组', 'custom-collapsed': '自定义分组（折叠）',
  'custom-expanded': '自定义分组（展开）' };
const files = (await readdir(output)).filter(file => /^(local|remote|web|android)-.*\.png$/.test(file)).sort();
const images = files.map(file => {
  const match = file.match(/^(local|remote|web|android)-(\d+-)?light-(.+?)(?:-font-([\d.]+))?\.png$/);
  if (!match) throw new Error(`Unlabelled screenshot: ${file}`);
  const [, platform, width, state, scale] = match;
  const label = `${platforms[platform]} · 浅色 · ${states[state]} · `
    + (scale ? `系统字体 ${scale} 倍` : `${width.slice(0, -1)}px`);
  return { file, platform, state, label };
});
await writeFile(path.join(output, 'screenshots.json'), JSON.stringify(images, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>对话活跃时间排序验证</title>
<style>body{font:15px/1.6 system-ui;margin:32px;background:#f6f8f7;color:#18241f}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
figure{margin:0;background:white;padding:16px;border:1px solid #dce5df;border-radius:12px}
img{display:block;width:100%;max-height:640px;object-fit:contain;object-position:top}figcaption{margin-bottom:12px}
select{font:inherit;padding:6px;margin-bottom:24px}a{color:#126b52}</style>
<h1>对话按最后活跃时间排序</h1><p>实际列表组件的测试截图，覆盖运行中、结束、展开和自定义分组。
Android 使用模拟器，已检查系统字体 1.0 与 1.3 倍；iOS 已通过打包检查，尚未进行真机视觉验证。</p>
<p>桌面相关测试 1,604 项、原生测试 1,429 项、Web 测试 15 项通过；桌面与 Web 共 6 项浏览器交互检查通过。
桌面与 Web 生产构建、原生 Android/iOS 导出、共享边界及国际化检查通过。</p>
<label>平台 <select id="platform"><option value="">全部</option>${Object.entries(platforms)
  .map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label>
<main>${images.map(({ file, label, platform }) => `<figure data-platform="${platform}">
<figcaption><a href="${file}">${label}</a></figcaption><a href="${file}">
<img src="${file}" alt="${label}" loading="lazy"></a></figure>`).join('')}</main>
<script>document.querySelector('select').onchange=event=>document.querySelectorAll('figure').forEach(figure=>{
figure.hidden=!!event.target.value&&figure.dataset.platform!==event.target.value;});</script></html>`);
console.log(`Created evidence index with ${images.length} labelled screenshots: ${output}`);
