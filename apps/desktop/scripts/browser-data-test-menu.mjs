import { chromium } from '@playwright/test';

export async function connectBrowserOverlay(nativeEndpoint) {
  const connection = await chromium.connectOverCDP(nativeEndpoint);
  const popup = connection.contexts().flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith('about:blank#remoteai-browser-overlay'));
  if (popup) return { connection, popup };
  await connection.close();
  throw new Error('The native browser overlay is unavailable');
}

export async function openBrowserDataMenuItem(page, label, nativeEndpoint) {
  await page.getByRole('button', { name: '浏览器设置', exact: true }).click();
  const item = target => target.getByRole('button', { name: label, exact: true });
  if (!nativeEndpoint || await item(page).isVisible()) {
    await item(page).click();
    return;
  }

  // Native browser menus may use a WebView created after the main page's CDP connection.
  const { connection, popup } = await connectBrowserOverlay(nativeEndpoint);
  try {
    await item(popup).click();
  } finally { await connection.close(); }
}
