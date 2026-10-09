import { imageEditorIcon, type ImageEditorIcon } from './imageEditorIcons';

const TOOLS: [ImageEditorIcon, string][] = [
  ['pen', '画笔'], ['arrow', '箭头'], ['rectangle', '方框'], ['text', '文字'], ['mosaic', '马赛克'], ['eraser', '橡皮擦'],
];
const COLORS = [['#ef4444', '红色'], ['#facc15', '黄色'], ['#22c55e', '绿色'],
  ['#3b82f6', '蓝色'], ['#ffffff', '白色'], ['#111111', '黑色']];
const WIDTHS = [[3, 4, '很细'], [6, 8, '细'], [10, 12, '中'], [16, 17, '粗'], [24, 23, '很粗']] as const;

export function imageEditorControls(label: (text: string) => string) {
  return `<footer><div id="tools" role="group" aria-label="${label('标注工具')}">
${TOOLS.map(([tool, name]) => `<button class="tool" data-tool="${tool}" aria-pressed="${tool === 'pen'}">
  ${imageEditorIcon(tool)}<span>${label(name)}</span></button>`).join('')}
</div><div id="colors" role="group" aria-label="${label('标注颜色')}">
${COLORS.map(([color, name], index) => `<button class="color" data-color="${color}" aria-label="${label(name)}"
  aria-pressed="${index === 0}"><span class="swatch" style="background:${color}"></span></button>`).join('')}
<button class="color" id="custom-color" aria-label="${label('自定义颜色')}" aria-pressed="false">
  <span class="swatch rainbow"></span></button>
</div><div class="width-row"><span class="width-label" id="width-label">${label('画笔粗细')}</span>
<div id="widths" role="group" aria-labelledby="width-label">
${WIDTHS.map(([width, dot, name]) => `<button class="width" data-width="${width}" aria-label="${label(name)}"
  aria-pressed="${width === 6}"><span><i style="--dot:${dot}px"></i></span></button>`).join('')}
</div></div><div class="bottom">
<button id="reset" disabled>${imageEditorIcon('reset')}${label('重置')}</button>
<p id="notice" role="status">${label('正在加载图片…')}</p>
<div class="history"><button id="redo" aria-label="${label('重做')}" hidden>${imageEditorIcon('redo')}</button>
<button id="undo" aria-keyshortcuts="Control+z Meta+z" disabled>${imageEditorIcon('undo')}${label('撤销')}</button></div>
</div></footer>`;
}

export function imageEditorDialogs(label: (text: string) => string) {
  return `<dialog id="text-dialog" aria-labelledby="text-title">
<h2 id="text-title">${label('添加文字')}</h2>
<textarea id="text-value" aria-label="${label('标注文字')}" placeholder="${label('输入要标注的文字')}"
  maxlength="200" rows="3"></textarea><div class="dialog-actions">
<button type="button" data-close="text-dialog">${label('取消')}</button>
<button class="primary" id="text-add" type="button">${label('添加')}</button></div></dialog>
<dialog id="color-dialog" aria-labelledby="color-title">
<h2 id="color-title">${label('自定义颜色')}</h2><div class="color-preview" id="color-preview"></div>
${['红色', '绿色', '蓝色'].map((name, index) => `<label class="color-channel">${label(name)}
  <input type="range" data-channel="${index}" min="0" max="255" value="0"></label>`).join('')}
<input id="color-value" aria-label="${label('颜色值')}" pattern="#[0-9a-fA-F]{6}" maxlength="7" required
  autocomplete="off" spellcheck="false"><div class="dialog-actions">
<button type="button" data-close="color-dialog">${label('取消')}</button>
<button class="primary" id="color-apply" type="button">${label('使用颜色')}</button></div></dialog>`;
}
