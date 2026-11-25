import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { testBrowserLaunchOptions } from "./test-browser.mjs";

const assetsRoot = new URL("../apps/desktop/src-tauri/resources/dream-skin/assets/", import.meta.url);
const nativeStyles = `
  body { margin: 0; font-family: monospace; }
  aside { width: 240px; }
  .sidebar-navigation { background: white; }
  [role="navigation"] { --color-text: black; }
  .text-default { color: var(--color-text, black); }
  .bg-surface { background: var(--color-surface, white); }
  main { min-height: 600px; }
  .bg-background-composer-action-bar { background: white; }
  [data-app-shell-main-content-top-fade] { display: flex; flex-direction: column; }
  .app-shell-main-content-top-fade, [class*="_MainContentTopFade_"] {
    position: absolute; height: 16px; pointer-events: none;
    background: linear-gradient(white, transparent);
  }
  [data-composer-body], [class*="_ComposerLayoutBody_"] {
    background: white; border: 1px solid silver; box-shadow: 0 0 4px gray; backdrop-filter: blur(10px);
  }
`;
let browser;
before(async () => { browser = await chromium.launch(testBrowserLaunchOptions({ headless: true })); });
after(async () => { await browser?.close(); });

function shellMarkup({ placement = "home", legacy = false, hashedBody = false } = {}) {
  const composerClass = legacy ? "composer-surface-chrome" : "_ComposerLayoutRoot_fixture_2";
  const bodyMarker = hashedBody ? 'class="_ComposerLayoutBody_fixture_2"' : "data-composer-body";
  return `<style>${nativeStyles}</style>
    <aside class="app-shell-left-panel"><div class="sidebar-navigation">
      <nav role="navigation"><span class="text-default">Native label</span></nav></div></aside>
    <main data-app-shell-main-surface="default">
      <div data-app-shell-main-content-top-fade="visible">
        <div class="${legacy ? 'app-shell-main-content-top-fade' : '_MainContentTopFade_fixture_2'}"></div>
        <section role="main">
      <div data-codex-composer-root data-composer-placement="${placement}">
        <aside class="bg-surface text-default">Native notice</aside>
        <div class="bg-background-composer-action-bar">Project rail</div>
        <div data-composer-home-utility-bar-position="above"><button>Project</button></div>
        <div class="${composerClass}" data-composer-layout="multiline" data-composer-surface-variant="default">
          <div ${bodyMarker}><div class="ProseMirror" contenteditable="true">Draft</div>
            <div class="_ComposerLayoutFooter_fixture_2" data-composer-layout="multiline">Footer</div>
          </div>
        </div>
      </div>
    </section></div></main>`;
}

async function rendererPayload(page, { platform, appearance, wide = true }) {
  const art = await page.evaluate((wide) => {
    const canvas = document.createElement("canvas");
    canvas.width = wide ? 160 : 90;
    canvas.height = wide ? 90 : 160;
    const context = canvas.getContext("2d");
    context.fillStyle = "#315b87";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  }, wide);
  const theme = { id: "regression", appearance, art: { taskMode: "ambient", overlayOpacity: 0.5 },
    artMetadata: { ratio: wide ? 16 / 9 : 9 / 16, wide, aspect: wide ? "wide" : "standard" } };
  const css = await readFile(new URL(`${platform}/dream-skin.css`, assetsRoot), "utf8");
  const template = await readFile(new URL(`${platform}/renderer-inject.js`, assetsRoot), "utf8");
  const replacements = { CSS: css, ART: art, THEME: theme, VERSION: "1.2.3",
    STYLE_REVISION: "regression", PAYLOAD_REVISION: "regression" };
  return template.replace(/__DREAM_(?:SKIN_)?(\w+)_JSON__/g, (_match, key) => JSON.stringify(replacements[key]));
}

async function inspectComposer(page) {
  return page.evaluate(() => {
    const composer = document.querySelector('[data-composer-surface-variant]');
    const body = composer.firstElementChild;
    const bodyStyle = getComputedStyle(body);
    const rootStyle = getComputedStyle(composer);
    return {
      home: document.querySelector('[role="main"]').className,
      background: rootStyle.backgroundColor,
      nestedBackground: bodyStyle.backgroundColor,
      nestedShadow: bodyStyle.boxShadow,
      nestedBorder: bodyStyle.borderTopWidth,
      nestedFilter: bodyStyle.backdropFilter,
      font: getComputedStyle(document.body).fontFamily,
      styles: document.querySelectorAll('#codex-dream-skin-style').length,
      chrome: document.querySelectorAll('#codex-dream-skin-chrome').length,
      draft: document.querySelector('[contenteditable]').textContent,
      contentDisplay: getComputedStyle(document.querySelector('[data-app-shell-main-content-top-fade]')).display,
      composerHeight: composer.getBoundingClientRect().height,
      fadeBackground: getComputedStyle(document.querySelector(
        '.app-shell-main-content-top-fade, [class*="_MainContentTopFade_"]')).backgroundImage,
      railBackground: getComputedStyle(document.querySelector('.bg-background-composer-action-bar')).backgroundColor,
      sidebarBackground: getComputedStyle(document.querySelector('.sidebar-navigation')).backgroundColor,
      nativeText: getComputedStyle(document.querySelector('.text-default')).color,
      themeText: getComputedStyle(document.body).color,
      noticeBackground: getComputedStyle(document.querySelector('.bg-surface')).backgroundColor,
    };
  });
}

function threadFooterMarkup({ legacy, detachedFade = false }) {
  const layerClass = legacy ? "bg-gradient-to-t" : "bg-surface";
  const layerMarker = legacy ? "" : 'aria-hidden="true"';
  const fade = detachedFade ? `<div aria-hidden="true" class="pointer-events-none sticky bottom-0">
    <div aria-hidden="true" class="_background_fixture_2 _fade_fixture_2 pointer-events-none from-surface"></div>
  </div>` : "";
  return shellMarkup({ placement: "thread", legacy }).replace('<section role="main">', `
    <section role="main"><style>
      .thread-scroll-container { position: relative; min-height: 500px; }
      [data-thread-scroll-footer] { position: absolute; bottom: 0; width: 100%; padding-bottom: 16px; }
      .footer-backdrop { position: absolute; inset: 0; pointer-events: none; }
      .bg-gradient-to-t { background: linear-gradient(to top, white 80%, transparent); }
      ._fade_fixture_2, .functional-gradient { background: linear-gradient(to top, white, transparent); }
      ._fade_fixture_2 { position: absolute; bottom: 100%; width: 100%; height: 32px; }
      .sticky { position: sticky; bottom: 0; }
      [data-codex-composer-root] { position: relative; margin-inline: 100px; }
    </style><div class="thread-scroll-container" data-app-action-timeline-scroll>
      <div class="transcript-content"><div class="functional-gradient">Transcript card</div>${fade}</div>
      <div data-thread-scroll-footer="true">
        <div ${layerMarker} class="footer-backdrop pointer-events-none ${layerClass}"></div>
        <div data-pip-obstacle="thread-footer">`).replace('</section>', `
        </div><aside class="bg-surface footer-notice">Footer notice</aside>
      </div></div></section>`);
}

async function inspectFooter(page) {
  return page.evaluate(() => {
    const backdrop = document.querySelector('.footer-backdrop');
    const style = getComputedStyle(backdrop);
    const fade = document.querySelector('._fade_fixture_2');
    return { background: style.backgroundColor, image: style.backgroundImage,
      height: backdrop.getBoundingClientRect().height,
      fade: fade ? { background: getComputedStyle(fade).backgroundColor,
        image: getComputedStyle(fade).backgroundImage, height: fade.getBoundingClientRect().height } : null,
      functionalGradient: getComputedStyle(document.querySelector('.functional-gradient')).backgroundImage,
      footerHeight: document.querySelector('[data-thread-scroll-footer]').getBoundingClientRect().height,
      notice: getComputedStyle(document.querySelector('.footer-notice')).backgroundColor };
  });
}

for (const platform of ["windows", "macos"]) {
  test(`${platform}: 26.1120 wallpaper shows through the workspace with the sidebar closed`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<div data-app-shell-frame style="background-image:linear-gradient(white,white)">
        <header data-app-shell-titlebar style="background:white">ChatGPT</header>
        <div data-app-shell-workspace>
          <div aria-hidden="true" class="pointer-events-none" data-app-shell-surface-backing
            style="background:white"></div>
          ${shellMarkup()}
        </div></div>`);
      await page.locator("aside.app-shell-left-panel").evaluate((sidebar) => sidebar.remove());
      const paints = () => page.evaluate(() => [
        getComputedStyle(document.querySelector("[data-app-shell-frame]")).backgroundImage,
        getComputedStyle(document.querySelector("[data-app-shell-surface-backing]")).backgroundColor,
        getComputedStyle(document.querySelector("header")).backgroundColor,
        getComputedStyle(document.body).backgroundImage,
      ]);
      const original = await paints();
      for (const appearance of ["light", "dark"]) {
        await page.evaluate(await rendererPayload(page, { platform, appearance }));
        const [frame, backing, titlebar, wallpaper] = await paints();
        assert.equal(frame, "none");
        assert.equal(backing, "rgba(0, 0, 0, 0)");
        assert.notEqual(titlebar, original[2]);
        assert.match(wallpaper, /url\(/);
      }
      await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.cleanup());
      assert.deepEqual(await paints(), original);
    } finally {
      await page.close();
    }
  });

  for (const version of ["legacy", "26.928", "26.1021"]) {
    test(`${platform}: ${version} thread footer stays clear when switching skins`, async () => {
      const page = await browser.newPage();
      try {
        await page.setContent(threadFooterMarkup({
          legacy: version === "legacy", detachedFade: version === "26.1021",
        }));
        const nativeFooter = await inspectFooter(page);
        assert.ok(nativeFooter.height > 0);
        assert.ok(nativeFooter.image !== "none" || nativeFooter.background !== "rgba(0, 0, 0, 0)");
        if (nativeFooter.fade) assert.notEqual(nativeFooter.fade.image, "none");
        for (const appearance of ["light", "dark", "light"]) {
          await page.evaluate(await rendererPayload(page, { platform, appearance }));
          const footer = await inspectFooter(page);
          assert.equal(footer.background, "rgba(0, 0, 0, 0)", "the full-width footer must not hide the artwork");
          assert.equal(footer.image, "none");
          if (footer.fade) {
            assert.equal(footer.fade.image, "none", "the separate sticky fade must not leave a white band");
            assert.equal(footer.fade.background, "rgba(0, 0, 0, 0)");
            assert.equal(footer.fade.height, nativeFooter.fade.height, "preserve the sticky scroll geometry");
          }
          assert.equal(footer.functionalGradient, nativeFooter.functionalGradient);
          assert.ok(footer.height > 0, "the decorative layer remains in the layout");
          assert.equal(footer.height, footer.footerHeight, "the layer still covers the footer");
          assert.notEqual(footer.notice, "rgba(0, 0, 0, 0)", "functional surfaces keep their backgrounds");
          const composer = await inspectComposer(page);
          assert.notEqual(composer.background, "rgba(0, 0, 0, 0)");
          assert.equal(composer.nestedBackground, "rgba(0, 0, 0, 0)");
          assert.equal(composer.draft, "Draft");
        }
        await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.cleanup());
        assert.deepEqual(await inspectFooter(page), nativeFooter);
      } finally {
        await page.close();
      }
    });
  }

  for (const appearance of ["light", "dark"]) {
    for (const placement of ["home", "thread"]) {
      test(`${platform} ${appearance}: current ${placement} composer keeps one themed surface`, async () => {
        const page = await browser.newPage();
        try {
          await page.setContent(shellMarkup({ placement, hashedBody: appearance === "dark" }));
          const source = await rendererPayload(page, { platform, appearance });
          await page.evaluate(source);
          const result = await inspectComposer(page);
          assert.equal(result.nestedBackground, "rgba(0, 0, 0, 0)");
          assert.equal(result.nestedShadow, "none");
          assert.equal(result.nestedBorder, "0px");
          assert.equal(result.nestedFilter, "none");
          assert.notEqual(result.background, "rgba(0, 0, 0, 0)");
          assert.equal(result.font, "monospace");
          assert.equal(result.home.includes("home"), placement === "home", "home-icon has not mounted yet");
          assert.equal(result.draft, "Draft");
          assert.equal(result.contentDisplay, "flex", "26.924 puts the fade state on the content container");
          assert.ok(result.composerHeight > 0, "native content must remain visible");
          assert.equal(result.fadeBackground, "none");
          assert.notEqual(result.railBackground, "rgb(255, 255, 255)");
          assert.equal(result.sidebarBackground, "rgba(0, 0, 0, 0)");
          assert.equal(result.nativeText, result.themeText);
          assert.notEqual(result.noticeBackground, "rgb(255, 255, 255)");

          await page.evaluate(source);
          const reapplied = await inspectComposer(page);
          assert.equal(reapplied.styles, 1);
          assert.equal(reapplied.chrome, 1);
          assert.equal(reapplied.draft, "Draft");
          await page.evaluate(() => window.__CODEX_DREAM_SKIN_STATE__.cleanup());
          assert.equal(await page.locator("html").getAttribute("class"), "");
          assert.equal(await page.locator("#codex-dream-skin-style").count(), 0);
        } finally {
          await page.close();
        }
      });
    }
  }

  test(`${platform}: legacy composer and delayed home icon remain supported`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(shellMarkup({ legacy: true }));
      await page.locator('[data-codex-composer-root]').evaluate((node) => {
        node.removeAttribute("data-composer-placement");
      });
      await page.evaluate(await rendererPayload(page, { platform, appearance: "dark" }));
      assert.equal((await inspectComposer(page)).home.includes("home"), false);
      await page.locator('[role="main"]').evaluate((node) => {
        const icon = document.createElement("span");
        icon.dataset.testid = "home-icon";
        node.append(icon);
      });
      await page.waitForFunction(() => document.querySelector('[role="main"]').className.includes("home"));
      assert.equal((await inspectComposer(page)).nestedBackground, "rgba(0, 0, 0, 0)");
    } finally {
      await page.close();
    }
  });

  test(`${platform}: modern home keeps the empty announcement slot collapsed`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(shellMarkup());
      await page.locator('[role="main"]').evaluate((home) => {
        const composer = home.firstElementChild;
        const layout = document.createElement("div");
        layout.className = "group/home-composer-layout";
        layout.style.cssText = "display:flex;flex-direction:column;height:600px";
        const banner = document.createElement("div");
        banner.id = "announcement";
        banner.append(document.createElement("div"));
        layout.append(banner, composer);
        home.append(layout);
      });
      await page.evaluate(await rendererPayload(page, { platform, appearance: "light" }));
      const banner = await page.locator('#announcement').boundingBox();
      assert.equal(banner.height, 0, "legacy hero sizing must not expand a modern empty slot");
      await page.evaluate(await rendererPayload(page, { platform, appearance: "light", wide: false }));
      const background = await page.locator('[role="main"]').evaluate((node) => getComputedStyle(node).backgroundImage);
      assert.match(background, /url\(/, "portrait themes need a background without the legacy hero card");
    } finally {
      await page.close();
    }
  });
}
