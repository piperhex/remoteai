import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { siteUrl } from './site.config.mjs';

// External React/Ant Design modules must use the same production mode as the client bundle.
process.env.NODE_ENV = 'production';
const { render, renderMarkdown, routes, pageMetadata } = await import('../.prerender/entry-server.js');

const dist = resolve('dist');
const template = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!template.includes('<!--site-head-->') || !template.includes('<!--site-body-->')) {
  throw new Error('The build template is missing prerender placeholders.');
}

const registry = JSON.parse(await readFile(new URL('../../../packages/i18n/languages.json', import.meta.url), 'utf8'));
const languageTags = Object.fromEntries(registry.languages.map(({ id, tag }) => [id, tag]));

function html(route) {
  const result = render(route);
  return template
    .replace('lang="zh-CN"', `lang="${languageTags[route.language]}"`)
    .replace('<div id="root">', `<div id="root" data-language="${route.language}" data-path="${route.path}">`)
    .replace('<!--site-head-->', () => result.head)
    .replace('<!--site-body-->', () => result.body);
}

for (const route of routes) {
  const directory = resolve(dist, route.outputPath);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), html(route));
  await writeFile(resolve(directory, 'index.md'), renderMarkdown(route));
}
await writeFile(resolve(dist, '404.html'), html({ language: 'zh', path: '404/' }));
await writeFile(resolve(dist, '.nojekyll'), '');

const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const sitemap = routes.map((route) => `<url><loc>${escapeXml(new URL(route.outputPath, siteUrl).href)}</loc></url>`);
await writeFile(
  resolve(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${sitemap.join('\n')}\n</urlset>\n`,
);
await writeFile(resolve(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);

const references = routes.map((route) => {
  const meta = pageMetadata(route);
  return `- [${meta.title}](${new URL(`${route.outputPath}index.md`, siteUrl).href}): ${meta.description}`;
});
await writeFile(
  resolve(dist, 'llms.txt'),
  [
    '# Remote AI',
    '',
    '> Open-source graphical AI coding workspace for Codex. Formerly Codex Switch.',
    '',
    'Remote AI is an independent Apache-2.0 project, unaffiliated with OpenAI.',
    'Model access requires your own account or compatible Provider. Remote use requires an online host.',
    '',
    '## Product documentation',
    '',
    ...references,
    '',
    '## Source',
    '',
    '- [GitHub](https://github.com/piperhex/remoteai)',
    '',
  ].join('\n'),
);
console.log(`Exported ${routes.length} complete HTML pages and text equivalents for ${siteUrl}`);
