export const imageEditorDesktopStyles = String.raw`
body[data-desktop-editor] #widths { display: none; }
@media (min-width: 900px) {
body[data-desktop-editor] {
  --surface: #f0f3f6; --panel: #fbfcfd; --ink: #18212a; --green: #08945c;
  display: grid; grid-template-columns: minmax(0, 1fr) clamp(280px, 30%, 410px);
  grid-template-rows: auto minmax(0, 1fr) 56px; gap: 18px;
  padding: 26px; background: #f9fbfc;
}
body[data-desktop-editor] header { grid-column: 1 / -1; padding: 0 40px 2px 12px; }
body[data-desktop-editor] .heading { text-align: left; }
body[data-desktop-editor] h1 { font-size: 28px; font-weight: 700; letter-spacing: 0; }
body[data-desktop-editor] .heading p { margin-top: 4px; font-size: 16px; }
body[data-desktop-editor] #stage { padding: 16px; border-radius: 18px; background: #edf3f6;
  position: relative; isolation: isolate; }
body[data-desktop-editor] #canvas { flex-shrink: 0; border-radius: 10px; }
.editor-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 38px;
  padding: 24px; overflow-y: auto; border: 1px solid #eef0f2; border-radius: 18px; background: var(--panel); }
.editor-panel h2 { margin: 0 0 16px; font-size: 16px; font-weight: 650; }
body[data-desktop-editor] #tools { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
body[data-desktop-editor] .tool { min-height: 78px; padding: 10px 3px; gap: 8px; font-size: 14px; }
body[data-desktop-editor] .tool svg { width: 27px; height: 27px; }
body[data-desktop-editor] #colors { padding: 0; gap: 2px; background: transparent; }
body[data-desktop-editor] .swatch { width: 26px; height: 26px; }
body[data-desktop-editor] [data-color="#ffffff"] .swatch { border: 1px solid #d8dde2; }
.stroke-slider { display: flex; align-items: center; gap: 24px; min-height: 32px; }
#stroke-width { flex: 1; min-width: 0; margin: 0; height: 6px; appearance: none; border-radius: 8px;
  background: linear-gradient(to right, var(--green) var(--fill, 13.04%), #e7ebef var(--fill, 13.04%));
  cursor: pointer; }
#stroke-width::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px;
  border: 0; border-radius: 50%; background: var(--green); }
#stroke-width::-moz-range-thumb { width: 18px; height: 18px;
  border: 0; border-radius: 50%; background: var(--green); }
#stroke-width-value { min-width: 42px; font-size: 15px; text-align: right; white-space: nowrap; }
body[data-desktop-editor] #notice { flex: none; order: initial; margin: auto 0 0; padding: 0;
  text-align: left; font-size: 12px; }
.canvas-toolbar, .viewport-controls, .zoom-controls { display: flex; align-items: center; gap: 8px; }
.canvas-toolbar { min-width: 0; justify-content: space-between; }
.canvas-toolbar button { width: 40px; min-height: 40px; padding: 8px; border-radius: 50%; }
.canvas-toolbar button svg { width: 20px; height: 20px; }
.viewport-controls > button, .zoom-controls { background: #f1f4f7; }
.zoom-controls { gap: 0; border: 1px solid #e7ebef; border-radius: 24px; }
#zoom-value { min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
#pan[aria-pressed="true"] { background: var(--selected); color: var(--green); }
body[data-desktop-editor] .history { align-items: center; gap: 4px; color: #727b84; }
body[data-desktop-editor] #reset { width: auto; margin-left: 10px; padding-inline: 24px;
  border-radius: 12px; color: var(--ink); background: #edf1f5; font-size: 16px; }
.editor-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.editor-actions button { width: 100%; font-size: 18px; font-weight: 550; }
body[data-desktop-editor] #cancel { color: var(--ink); background: #e9eef3; }
body[data-desktop-editor] #done { background: var(--green); }
body[data-desktop-editor] button:not(:disabled):hover { filter: brightness(.97); }
@media (max-width: 1000px), (max-height: 650px) {
  body[data-desktop-editor] { grid-template-columns: minmax(0, 1fr) 280px;
    padding: 18px; gap: 14px; grid-template-rows: auto minmax(0, 1fr) 48px; }
  body[data-desktop-editor] header { padding-left: 6px; }
  body[data-desktop-editor] h1 { font-size: 24px; }
  body[data-desktop-editor] .heading p { font-size: 14px; }
  .editor-panel { padding: 18px; gap: 24px; }
  body[data-desktop-editor] #tools { gap: 8px; }
  body[data-desktop-editor] .tool { min-height: 64px; font-size: 12px; gap: 6px; }
  body[data-desktop-editor] .tool svg { width: 24px; height: 24px; }
  body[data-desktop-editor] .swatch { width: 23px; height: 23px; }
  .canvas-toolbar, .viewport-controls { gap: 4px; }
  .canvas-toolbar button { width: 34px; min-height: 34px; padding: 6px; }
  #zoom-value { min-width: 46px; font-size: 13px; }
  body[data-desktop-editor] #reset { padding-inline: 14px; margin-left: 4px; font-size: 14px; }
}
@media (max-height: 750px) {
  .editor-panel { gap: 12px; padding: 16px; }
  .editor-panel h2 { margin-bottom: 10px; font-size: 14px; }
  body[data-desktop-editor] .tool { min-height: 56px; padding-block: 6px; gap: 4px; }
  body[data-desktop-editor] .tool svg { width: 22px; height: 22px; }
  body[data-desktop-editor] #notice { font-size: 10px; }
}
@media (max-height: 540px) {
  .editor-panel { gap: 10px; padding: 14px; }
  .editor-panel h2 { margin-bottom: 6px; font-size: 13px; }
  body[data-desktop-editor] .tool { flex-direction: row; min-height: 40px; font-size: 11px; }
  body[data-desktop-editor] .tool svg { width: 18px; height: 18px; }
}
}
@media (max-width: 899px) {
  body[data-desktop-editor] { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: auto minmax(0, 1fr) auto auto; }
  body[data-desktop-editor] header { grid-column: 2; grid-row: 1; display: block; padding: 12px 4px; }
  body[data-desktop-editor] h1 { font-size: 18px; }
  body[data-desktop-editor] .heading p { display: none; }
  .editor-actions { display: contents; }
  body[data-desktop-editor] #cancel { grid-area: 1 / 1; margin: 8px 0 8px 12px; align-self: center; }
  body[data-desktop-editor] #done { grid-area: 1 / 3; margin: 8px 48px 8px 0; align-self: center; }
  body[data-desktop-editor] #stage { grid-column: 1 / -1; grid-row: 2; padding: 10px 20px 16px; }
  .editor-panel { grid-column: 1 / -1; grid-row: 3; display: flex; flex-direction: column;
    min-height: 0; gap: 12px; padding: 16px 14px 6px; border-radius: 24px 24px 0 0;
    background: var(--panel); overflow-y: auto; }
  .editor-panel section > h2 { display: none; }
  body[data-desktop-editor] #tools { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
  body[data-desktop-editor] [data-tool="circle"] { display: none; }
  .stroke-section { display: flex; align-items: center; gap: 10px; }
  .editor-panel .stroke-section h2 { display: block; margin: 0; font-size: 13px; font-weight: 550; }
  body[data-desktop-editor] #widths { display: grid; }
  .stroke-slider, .viewport-controls { display: none; }
  body[data-desktop-editor] #notice { order: initial; padding: 0; flex: none; }
  .canvas-toolbar { grid-column: 1 / -1; grid-row: 4; padding: 0 12px 8px; background: var(--panel); }
  body[data-desktop-editor] .history { justify-content: flex-end; align-items: center; gap: 6px; }
  .canvas-toolbar button { min-height: 36px; padding: 6px; color: #757c84; }
  body[data-desktop-editor] #reset { margin-right: auto; order: -1; }
}
@media (min-width: 560px) and (max-width: 899px) and (max-height: 500px) {
  body[data-desktop-editor] { grid-template-columns: minmax(0, 1fr) 300px; }
  body[data-desktop-editor] header { grid-column: 1 / -1; padding: 10px 100px; }
  body[data-desktop-editor] #cancel { grid-area: 1 / 1; }
  body[data-desktop-editor] #done { grid-area: 1 / 2; }
  body[data-desktop-editor] #stage { grid-column: 1; grid-row: 2 / 5; }
  .editor-panel { grid-column: 2; grid-row: 2; padding: 12px; gap: 8px; border-radius: 18px 0 0 0; }
  body[data-desktop-editor] #tools { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .canvas-toolbar { grid-column: 2; grid-row: 3 / 5; }
}
`;
