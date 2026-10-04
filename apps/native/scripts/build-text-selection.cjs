const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'shared/chat/touchTextSelection.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed,
} }).outputText;
// Hermes Function.toString() contains bytecode, so prepare WebView source before bundling the app.
const script = `(() => { const exports = {};\n${compiled}\n`
  + `exports.installTouchTextSelection(document.getElementById('content'));\n})();`;
const output = JSON.stringify({ script }) + '\n';
const target = path.join(root, 'apps/native/assets/text-selection.json');
const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
if (process.argv.includes('--check')) {
  if (previous !== output) throw new Error('Run node apps/native/scripts/build-text-selection.cjs');
} else if (previous !== output) fs.writeFileSync(target, output);
