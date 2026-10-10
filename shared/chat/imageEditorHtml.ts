import { validateChatImages } from '../remote-chat/attachments';
import type { ConnectionMode } from '../remote-chat/protocol';
import { getChatPolicy, KIB } from '../remote-chat/policy';
import { imageEditorControls, imageEditorDialogs } from './imageEditorControls';
import { imageEditorIcon } from './imageEditorIcons';
import { imageEditorScript } from './imageEditorScript';
import { imageEditorStyles } from './imageEditorStyles';
import { imageEditorDesktop } from './imageEditorDesktop';
import { imageEditorDesktopStyles } from './imageEditorDesktopStyles';

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

interface ImageEditorOptions { scriptUrl?: string; mode?: ConnectionMode }

/** A local canvas editor shared by desktop, phone WebView and browser. No remote images are loaded. */
export function imageEditorHtml(dataUrl: string, translate = (text: string) => text, language = 'zh-CN',
  { scriptUrl, mode }: ImageEditorOptions = {}) {
  validateChatImages([dataUrl], mode);
  const policy = getChatPolicy(mode);
  const label = (text: string) => escapeHtml(translate(text));
  const config = JSON.stringify({ dataUrl, desktop: !!scriptUrl, targetBytes: policy.imageTargetKb * KIB,
    maxEdge: policy.imageMaxEdge, labels: {
      saving: translate('正在保存…'),
      saveFailed: translate('图片保存失败，请撤销部分标注后重试。'),
      unavailable: translate('图片无法编辑，请重新打开后再试。'),
      hint: translate('在图片上拖动标注，完成后点「完成」。'),
      textHint: translate('点一下图片，添加文字。'),
      eraserHint: translate('拖动擦除标注，原图不受影响。'),
      panHint: translate('拖动查看图片，选择标注工具继续编辑。'),
      readFailed: translate('图片无法读取，请重新选择。'),
    } }).replace(/</g, '\\u003c');
  const locale = /^ru(?:-|$)/i.test(language) ? 'ru' : /^en(?:-|$)/i.test(language) ? 'en' : 'zh-CN';
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;
  script-src ${scriptUrl ? "'self'" : "'unsafe-inline'"}; style-src 'unsafe-inline'">
<style>${imageEditorStyles}${scriptUrl ? imageEditorDesktopStyles : ''}</style></head>
<body${scriptUrl ? ' data-browser-editor data-desktop-editor' : ''}>
${scriptUrl ? imageEditorDesktop(label) : `<header><button id="cancel">${imageEditorIcon('cancel')}${label('取消')}</button>
<div class="heading"><h1>${label('图片标注')}</h1><p>${label('在图片上画出重点')}</p></div>
<button id="done" disabled>${imageEditorIcon('done')}${label('完成')}</button></header>
<main id="stage"><canvas id="canvas" aria-label="${label('图片标注画布')}"></canvas></main>
${imageEditorControls(label)}`}${imageEditorDialogs(label)}
${scriptUrl
    ? `<script type="application/json" id="image-editor-config">${config}</script>
<script src="${escapeHtml(scriptUrl)}"></script>`
    : `<script>const config = ${config};${imageEditorScript}</script>`}</body></html>`;
}

export function editedImageMessage(raw: string, mode?: ConnectionMode): string | null {
  const message: unknown = JSON.parse(raw);
  if (!message || typeof message !== 'object' || !('type' in message)) return null;
  if (message.type !== 'save' || !('dataUrl' in message) || typeof message.dataUrl !== 'string') return null;
  validateChatImages([message.dataUrl], mode);
  return message.dataUrl;
}
