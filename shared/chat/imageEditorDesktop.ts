import { imageEditorColors, imageEditorTools, imageEditorWidths } from './imageEditorControls';
import { imageEditorIcon, type ImageEditorIcon } from './imageEditorIcons';

export function imageEditorDesktop(label: (text: string) => string) {
  const iconButton = (id: string, icon: ImageEditorIcon, name: string, attributes = '') =>
    `<button id="${id}" aria-label="${label(name)}" ${attributes}>${imageEditorIcon(icon)}</button>`;
  return `<header><div class="heading"><h1>${label('图片标注')}</h1>
<p>${label('在图片上添加标注、说明或高亮')}</p></div></header>
<main id="stage"><canvas id="canvas" aria-label="${label('图片标注画布')}"></canvas></main>
<aside class="editor-panel" aria-label="${label('标注工具')}">
<section><h2>${label('标注工具')}</h2>${imageEditorTools(label, true)}</section>
<section><h2>${label('颜色')}</h2>${imageEditorColors(label)}</section>
<section class="stroke-section"><h2 id="width-label"><label for="stroke-width">${label('画笔粗细')}</label></h2>
<div class="stroke-slider"><input id="stroke-width" type="range" min="1" max="24" value="4">
<output id="stroke-width-value" for="stroke-width">4 px</output></div>${imageEditorWidths(label, true)}</section>
<p id="notice" role="status">${label('正在加载图片…')}</p></aside>
<div class="canvas-toolbar">
<div class="viewport-controls">
${iconButton('pan', 'pan', '拖动图片', 'aria-pressed="false"')}
<div class="zoom-controls">${iconButton('zoom-out', 'minus', '缩小图片')}
<output id="zoom-value" aria-label="${label('缩放比例')}">100%</output>
${iconButton('zoom-in', 'plus', '放大图片')}</div>
${iconButton('fit', 'fit', '适应画布')}</div>
<div class="history">${iconButton('undo', 'undo', '撤销', 'aria-keyshortcuts="Control+z Meta+z" disabled')}
${iconButton('redo', 'redo', '重做', 'disabled')}
<button id="reset" disabled>${label('重置')}</button></div></div>
<div class="editor-actions"><button id="cancel">${label('取消')}</button>
<button id="done" disabled>${label('完成')}</button></div>`;
}
