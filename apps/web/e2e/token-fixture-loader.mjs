// Keep this measurement's live host fixture independent of unrelated workspace edits and external font availability.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith('/apps/desktop/e2e/mobile-fixture.mjs')) return result;
  const source = String(result.source)
    .replace("server: { port: uiPort, host: '127.0.0.1' }",
      "server: { port: uiPort, host: '127.0.0.1', hmr: false, watch: { ignored: ['**'] } }")
    .replace('await page.goto(', "await page.route('https://fonts.googleapis.com/**', route => route.abort());\n"
      + "await page.route('https://fonts.gstatic.com/**', route => route.abort());\nawait page.goto(");
  return { ...result, source };
}
