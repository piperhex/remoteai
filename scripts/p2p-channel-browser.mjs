import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { testBrowserArguments, testBrowserLaunchOptions } from './test-browser.mjs';

const args = ['--disable-features=WebRtcHideLocalIpsWithMdns'];

async function removeProfile(identifier) {
  const parent = resolve(process.env.LOCALAPPDATA);
  const profile = resolve(parent, identifier);
  if (dirname(profile) !== parent || basename(profile) !== identifier
    || !/^dev\.codex\.switch\.channel-benchmark-\d+$/.test(identifier)) {
    throw new Error('Invalid isolated benchmark profile');
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

/** Use only the isolated WebView test, never the full app with global helper registration. */
export async function channelBrowser(executable, options = {}) {
  if (!executable) {
    const browser = await chromium.launch(testBrowserLaunchOptions({ headless: true, args }));
    return { browser, page: await browser.newPage(), close: () => browser.close() };
  }
  if (process.platform !== 'win32') throw new Error('The WebView2 diagnostic requires Windows');
  const identifier = `dev.codex.switch.channel-benchmark-${Date.now()}`;
  const port = options.port ?? 9357;
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    throw new Error('Diagnostic debugging port is already occupied');
  } catch (error) { if (error.message.includes('occupied')) throw error; }
  const child = spawn(executable, [options.test ?? 'provider_browser::automation::tests::opens_conversation_browser',
    '--exact', '--ignored', '--nocapture'], { windowsHide: true,
    stdio: options.output ? ['ignore', 'pipe', 'pipe'] : 'ignore', env: { ...process.env,
    BROWSER_TEST_IDENTIFIER: identifier, BROWSER_TEST_DEBUG_PORT: String(port),
    BROWSER_TEST_CHILD_DEBUG_PORT: String(port),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: testBrowserArguments(args).join(' '),
  } });
  if (options.output) {
    child.stdout.on('data', bytes => options.output(String(bytes)));
    child.stderr.on('data', bytes => options.output(String(bytes)));
  }
  let failure;
  child.on('error', (error) => { failure = error; });
  const exited = new Promise((done) => child.once('exit', done));
  let browser;
  const close = async () => {
    await browser?.close();
    if (child.exitCode === null && !failure) { child.kill(); await exited; }
    await removeProfile(identifier);
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`WebView test exited: ${child.exitCode}`);
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    if (!browser) throw new Error('WebView debugging endpoint did not start');
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10000 });
    return { browser, page, identifier, close };
  } catch (error) { await close(); throw error; }
}
