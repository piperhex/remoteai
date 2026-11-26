import type { Route } from '../App';
import { copy, homeFaqs } from '@remoteai/i18n/website-content/copy';
import { featureContent, findFeature } from '@remoteai/i18n/website-content/features';
import { resourcesCopy } from '@remoteai/i18n/website-content/resources-copy';
import { resourceListSchema } from './resource-content';
import { languages, languageTags, pagePath, SITE_URL, LINKS } from './site';
import { ui } from '@remoteai/i18n/website-content/ui-text';

const openGraphLocales: Record<Route['language'], string> = {
  zh: 'zh_CN', en: 'en_US', ru: 'ru_RU', ja: 'ja_JP',
};

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}

export function pageMetadata({ language, path }: Route) {
  const t = copy(language);
  const feature = findFeature(path.split('/')[1]);
  const homeTitle = ui(language, 'homeTitle');
  if (feature) {
    const content = featureContent(feature, language);
    return {
      title: `${content.title} — ${ui(language, 'featureGuide')} | Remote AI`,
      description: content.summary,
    };
  }
  const pages = {
    '': { title: homeTitle, description: homeFaqs[language][0].answer },
    'features/': { title: `${t.nav.features} — Remote AI`, description: t.features.description },
    'download/': {
      title: `${t.nav.download} Remote AI — Windows / macOS / Linux`,
      description: t.download.description,
    },
    'guide/': { title: `${t.nav.guide} — Remote AI`, description: t.guide.description },
    'resources/': {
      title: `${resourcesCopy(language).title} — Remote AI`, description: resourcesCopy(language).metadata,
    },
    '404/': { title: '404 — Remote AI', description: ui(language, 'notFoundDescription') },
  };
  return pages[path as keyof typeof pages] ?? pages['404/'];
}

function applicationSchema(language: Route['language']) {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}#application`,
    name: 'Remote AI',
    alternateName: 'Codex Switch',
    url: SITE_URL,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows, macOS, Linux',
    license: LINKS.license,
    description: homeFaqs[language][0].answer,
    downloadUrl: LINKS.releases,
    screenshot: new URL('media/social-preview.png', SITE_URL).href,
    sameAs: [LINKS.repository],
    isAccessibleForFree: true,
  };
}

function structuredData(route: Route) {
  const { language, path } = route;
  const meta = pageMetadata(route);
  const url = new URL(pagePath(language, path), SITE_URL).href;
  const feature = findFeature(path.split('/')[1]);
  const nodes: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      url: SITE_URL,
      name: 'Remote AI',
      inLanguage: languages.map((item) => languageTags[item]),
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: meta.title,
      description: meta.description,
      inLanguage: languageTags[language],
      isPartOf: { '@id': `${SITE_URL}#website` },
    },
  ];
  if (!path) nodes.push(applicationSchema(language));
  if (path === 'resources/') nodes.push(resourceListSchema(language));
  if (path) nodes.push(breadcrumbSchema(route));
  const faq = feature
    ? featureContent(feature, language).faqs
    : !path || path === 'guide/'
      ? homeFaqs[language]
      : [];
  if (faq.length)
    nodes.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  return { '@context': 'https://schema.org', '@graph': nodes };
}

function breadcrumbSchema({ language, path }: Route) {
  const t = copy(language);
  const links = [{ name: t.common.home, path: '' }];
  if (path.startsWith('features/') && path !== 'features/') links.push({ name: t.nav.features, path: 'features/' });
  links.push({ name: pageMetadata({ language, path }).title.split(' — ')[0], path });
  return {
    '@type': 'BreadcrumbList',
    itemListElement: links.map((link, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: link.name,
      item: new URL(pagePath(language, link.path), SITE_URL).href,
    })),
  };
}

export function renderHead(route: Route) {
  const { language, path } = route;
  const { title, description } = pageMetadata(route);
  const url = new URL(pagePath(language, path), SITE_URL).href;
  const image = new URL('media/social-preview.png', SITE_URL).href;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${path === '404/' ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">`,
    `<link rel="icon" type="image/png" href="${new URL('media/favicon.png', SITE_URL).pathname}">`,
    `<link rel="icon" type="image/svg+xml" href="${new URL('favicon.svg', SITE_URL).pathname}">`,
    `<link rel="apple-touch-icon" href="${new URL('apple-touch-icon.png', SITE_URL).pathname}">`,
    ...socialTags({ title, description, url, image, language }),
  ];
  if (path === '404/') return tags.join('\n');
  tags.push(
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(`${url}index.md`)}">`,
    ...alternateTags(path),
    `<script type="application/ld+json">${JSON.stringify(structuredData(route)).replace(/</g, '\\u003c')}</script>`,
  );
  return tags.join('\n');
}

function alternateTags(path: string) {
  const alternates = languages.map((language) => [languageTags[language], pagePath(language, path)]);
  alternates.push(['x-default', path]);
  return alternates.map(
    ([language, relative]) =>
      `<link rel="alternate" hreflang="${language}" href="${escapeHtml(new URL(relative, SITE_URL).href)}">`,
  );
}

function socialTags(options: {
  title: string;
  description: string;
  url: string;
  image: string;
  language: Route['language'];
}) {
  const { title, description, url, image, language } = options;
  const properties = [
    ['og:type', 'website'],
    ['og:site_name', 'Remote AI'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', url],
    ['og:image', image],
    ['og:image:width', '1700'],
    ['og:image:height', '925'],
    ['og:image:alt', ui(language, 'socialImageAlt')],
    ['og:locale', openGraphLocales[language]],
    ...languages
      .filter((other) => other !== language)
      .map((other) => ['og:locale:alternate', openGraphLocales[other]]),
  ];
  return [
    ...properties.map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}">`),
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
  ];
}
