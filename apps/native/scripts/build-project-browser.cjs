const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '../../..');

function licenseNotices(inputs) {
  const packages = new Set();
  for (const input of Object.keys(inputs)) {
    const match = input.match(/^(.*node_modules\/)((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(path.resolve(root, match[1], match[2]));
  }
  return [...packages].sort().map(directory => {
    const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(name => fs.existsSync(path.join(directory, name)));
    if (!license) return '';
    const { name } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const notice = fs.readFileSync(path.join(directory, license), 'utf8').replace(/\r\n/g, '\n');
    return `${name}\n${notice.replace(/[ \t]+$/gm, '')}`;
  }).filter(Boolean).join('\n\n').replace(/--/g, '—');
}

async function build() {
  const result = await esbuild.build({
    absWorkingDir: root, metafile: true,
    // Keep module identities and license notices stable for npm links and physical package installs.
    preserveSymlinks: true,
    entryPoints: [path.join(root, 'shared/project-browser/nativeEntry.tsx')],
    bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['chrome100', 'safari16'],
    // Escape multiline snippets so generated source has no whitespace-only lines.
    supported: { 'template-literal': false },
    write: false, outfile: 'project-browser.js', jsx: 'automatic', legalComments: 'inline',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const script = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const html = `<!doctype html><!-- Bundled licenses:\n${licenseNotices(result.metafile.inputs)}\n-->
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy"
content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>html,body,#root{height:100%;margin:0;overflow:hidden}body{background:var(--panel,#fff)}
${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
  const target = path.join(root, 'apps/native/assets/project-browser.html');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== html) {
      throw new Error('File browser asset is outdated. Run node apps/native/scripts/build-project-browser.cjs');
    }
  } else fs.writeFileSync(target, html);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
