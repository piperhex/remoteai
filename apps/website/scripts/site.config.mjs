export const DEFAULT_SITE_URL = 'https://piperhex.github.io/remoteai/';

export function resolveSiteUrl(value = DEFAULT_SITE_URL) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error('WEBSITE_URL must be an HTTP(S) URL without credentials, query, or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

export const siteUrl = resolveSiteUrl(process.env.WEBSITE_URL || DEFAULT_SITE_URL);
export const basePath = new URL(siteUrl).pathname;
