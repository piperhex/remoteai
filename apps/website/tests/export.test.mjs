import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { siteUrl, basePath, resolveSiteUrl } from '../scripts/site.config.mjs';

const dist = resolve('dist');
const sitemap = readFileSync(resolve(dist, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const htmlFiles = urls.map((url) => ({
  url,
  html: readFileSync(resolve(dist, new URL(url).pathname.slice(basePath.length), 'index.html'), 'utf8'),
}));
const languageTags = { zh: 'zh-CN', en: 'en', ru: 'ru', ja: 'ja' };
const prefixes = { zh: '', en: 'en/', ru: 'ru/', ja: 'ja/' };

function pageLanguage(url) {
  const path = new URL(url).pathname.slice(basePath.length);
  if (path.startsWith('en/')) return { language: 'en', path: path.slice(3) };
  if (path.startsWith('ru/')) return { language: 'ru', path: path.slice(3) };
  if (path.startsWith('ja/')) return { language: 'ja', path: path.slice(3) };
  return { language: 'zh', path };
}

test('exports every language, every feature, and crawlable content without JavaScript', () => {
  assert.equal(urls.length, 64);
  for (const language of Object.keys(languageTags)) {
    assert.equal(urls.filter((url) => pageLanguage(url).language === language).length, 16, language);
  }
  const titles = new Set();
  for (const { url, html } of htmlFiles) {
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, url);
    assert.ok(!html.includes('<!--site-body-->'), url);
    assert.ok(!html.includes('<!--site-head-->'), url);
    assert.ok(html.includes('id="main"'), url);
    assert.ok(html.includes('<h2'), url);
    const title = html.match(/<title>(.*?)<\/title>/)?.[1];
    assert.ok(title, url);
    assert.ok(!titles.has(title), `Duplicate title: ${title}`);
    titles.add(title);
    assert.ok(html.includes(`rel="canonical" href="${url}"`), url);
    const { language, path } = pageLanguage(url);
    for (const [other, tag] of Object.entries(languageTags)) {
      const alternate = new URL(`${prefixes[other]}${path}`, siteUrl).href;
      assert.ok(html.includes(`rel="alternate" hreflang="${tag}" href="${alternate}"`), `${url} ${tag}`);
    }
    assert.ok(html.includes(`rel="alternate" hreflang="x-default" href="${new URL(path, siteUrl).href}"`), url);
    assert.ok(html.includes(`<html lang="${languageTags[language]}">`), url);
    const locale = { zh: 'zh_CN', en: 'en_US', ru: 'ru_RU', ja: 'ja_JP' }[language];
    assert.ok(html.includes(`<meta property="og:locale" content="${locale}">`), url);
    assert.equal((html.match(/property="og:locale:alternate"/g) ?? []).length, 3, url);
    const graphs = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];
    assert.equal(graphs.length, 1, url);
    assert.ok(
      JSON.parse(graphs[0][1])['@graph'].some((node) => node['@type'] === 'WebPage'),
      url,
    );
    assert.ok(html.includes('data-css-hash'), `Missing prerendered Ant Design styles: ${url}`);
    assert.ok(!html.includes('css-dev-only-do-not-override'), `Server styles differ from the production client: ${url}`);
  }
});

test('English and Russian pages never fall back to Chinese text', () => {
  for (const { url, html } of htmlFiles.filter(({ url }) => ['en', 'ru'].includes(pageLanguage(url).language))) {
    // Only language switch names may use Han characters on English and Russian pages.
    const text = html.replace(/<a [^>]*hreflang="(?:zh-CN|ja)"[^>]*>.*?<\/a>/gi, '');
    assert.equal(text.match(/\p{Script=Han}+/u)?.[0], undefined, url);
    const markdown = readFileSync(resolve(dist, new URL(url).pathname.slice(basePath.length), 'index.md'), 'utf8');
    assert.equal(markdown.match(/\p{Script=Han}+/u)?.[0], undefined, `${url}index.md`);
  }
});

test('the language switch links every page to the same page in the other languages', () => {
  for (const { url, html } of htmlFiles) {
    const { language, path } = pageLanguage(url);
    const links = [...html.matchAll(/<a class="language-link" href="([^"]+)"/g)].map((match) => match[1]);
    const expected = Object.keys(prefixes)
      .filter((other) => other !== language)
      .map((other) => `${basePath}${prefixes[other]}${path}`);
    assert.deepEqual(links, expected, url);
  }
});

test('all local links, navigation targets, styles, scripts and images resolve in the export', () => {
  for (const { url, html } of htmlFiles) {
    const targets = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    for (const target of targets) {
      if (/^(?:data:|mailto:|tel:)/.test(target)) continue;
      const resolved = new URL(target.replace(/&amp;/g, '&'), url);
      if (resolved.origin !== new URL(siteUrl).origin) continue;
      assert.ok(resolved.pathname.startsWith(basePath), `Outside website base: ${target}`);
      let file = resolve(dist, decodeURI(resolved.pathname.slice(basePath.length)));
      if (resolved.pathname.endsWith('/')) file = resolve(file, 'index.html');
      assert.ok(existsSync(file), `${url} links to missing ${target}`);
      if (resolved.hash && file.endsWith('.html')) {
        const document = readFileSync(file, 'utf8');
        assert.ok(document.includes(`id="${resolved.hash.slice(1)}"`), `Missing fragment: ${target} on ${url}`);
      }
    }
  }
});

test('feature exports contain detailed explanations, steps, images and matching text versions', () => {
  for (const { url, html } of htmlFiles.filter(({ url }) => /\/features\/[^/]+\/$/.test(url))) {
    assert.ok((html.match(/id="section-/g) ?? []).length >= 3, url);
    assert.ok(html.includes('id="getting-started"'), url);
    assert.ok(html.includes('<figure'), url);
    assert.ok(html.includes('<figcaption'), url);
    const faq = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1])['@graph'].find(
      (node) => node['@type'] === 'FAQPage',
    );
    assert.equal(faq.mainEntity.length, 2, url);
    const markdown = readFileSync(resolve(dist, new URL(url).pathname.slice(basePath.length), 'index.md'), 'utf8');
    assert.ok(markdown.length > 900, url);
    assert.ok(markdown.includes('https://github.com/piperhex/remoteai/blob/master/'), url);
  }
});

test('the AI resources page lists every resource with a description in every language', () => {
  const groups = ['models', 'docs', 'open-tools', 'agents', 'learn'];
  for (const [language, prefix] of Object.entries(prefixes)) {
    const url = new URL(`${prefix}resources/`, siteUrl).href;
    assert.ok(urls.includes(url), url);
    const folder = resolve(dist, `${prefix}resources`);
    const html = readFileSync(resolve(folder, 'index.html'), 'utf8');
    const cards = [...html.matchAll(/<a class="resource-card"[^>]*>/g)].map((match) => match[0]);
    assert.equal(cards.length, 26, url);
    for (const card of cards) {
      assert.match(card, /href="https:\/\/[^"]+"/, url);
      assert.ok(card.includes('target="_blank"') && card.includes('rel="noopener noreferrer"'), card);
    }
    for (const group of groups) {
      assert.ok(html.includes(`id="${group}"`), `${url} #${group}`);
      assert.ok(html.includes(`href="#${group}"`), `${url} navigation to #${group}`);
    }
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1])['@graph'];
    const list = graph.find((node) => node['@type'] === 'ItemList');
    assert.equal(list?.numberOfItems, 26, url);
    assert.equal(list.itemListElement.length, 26, url);
    for (const { item } of list.itemListElement) {
      assert.ok(item.name && item.url.startsWith('https://') && item.description, `${url} ${item.name}`);
      // Russian descriptions come from resources-ru.ts; an English fallback here means a missing translation.
      if (language === 'ru') assert.match(item.description, /\p{Script=Cyrillic}/u, `${url} ${item.name}`);
      if (language === 'ja') assert.match(item.description, /[\u3040-\u30ff]/u, `${url} ${item.name}`);
    }
    const markdown = readFileSync(resolve(folder, 'index.md'), 'utf8');
    assert.equal((markdown.match(/^- \[[^\]]+\]\(https:\/\/[^)]+\): \S/gm) ?? []).length, 26, `${url}index.md`);
  }
});

test('404 is not indexed and discovery files use the configured deployment URL', () => {
  assert.ok(readFileSync(resolve(dist, '404.html'), 'utf8').includes('noindex, follow'));
  assert.ok(readFileSync(resolve(dist, 'robots.txt'), 'utf8').includes(`Sitemap: ${siteUrl}sitemap.xml`));
  assert.ok(readFileSync(resolve(dist, 'llms.txt'), 'utf8').includes(`${siteUrl}features/codex-gui/index.md`));
  assert.ok(existsSync(resolve(dist, '.nojekyll')));
  assert.ok(!existsSync(resolve(dist, 'entry-server.js')));
});

test('custom domains and subpaths normalize safely', () => {
  assert.equal(resolveSiteUrl('https://example.com'), 'https://example.com/');
  assert.equal(resolveSiteUrl('https://example.com/product'), 'https://example.com/product/');
  assert.throws(() => resolveSiteUrl('javascript:alert(1)'));
  assert.throws(() => resolveSiteUrl('https://example.com/?preview=1'));
  assert.throws(() => resolveSiteUrl('https://user:secret@example.com/'));
});
