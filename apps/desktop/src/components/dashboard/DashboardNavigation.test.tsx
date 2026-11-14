// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { translate, type Translate } from "../../i18n";
import { DashboardNavigation, isToolboxPage } from "./DashboardNavigation";
import { buildDashboardMenuItems } from './dashboardMenuItems';
import { marketText } from '../../../../../shared/provider-market/i18n';
import { guiLanguage } from '../../../../../shared/localization/uiText';

const t: Translate = (key, params) => translate("en", key, params);

it('hides lounge everywhere until login and puts its unread badge above downloads', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DashboardNavigation page="accounts" onPageChange={() => {}}
      t={t} variant="sidebar" loungeUnread={4} />));
    expect(container.querySelector('.lounge-nav-icon')).toBeNull();
    expect(buildDashboardMenuItems(t, false, true).search.some(item => item.id === 'lounge')).toBe(false);
    await act(async () => root.render(<DashboardNavigation page="accounts" onPageChange={() => {}}
      t={t} variant="sidebar" loungeAvailable loungeUnread={4} />));
    const lounge = container.querySelector('.lounge-nav-icon')!.closest('button')!;
    expect(lounge.textContent).toContain('4');
    expect(lounge.nextElementSibling?.textContent).toBe(t('downloads.title'));
    expect(buildDashboardMenuItems(t, true, true).search.some(item => item.id === 'lounge')).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

describe.each([
  { page: "totp", label: "2FA" },
  { page: "coze", label: "Coze" },
  { page: "browser", label: marketText(guiLanguage())('market.browserNavigation') },
] as const)("$label navigation", ({ page, label }) => {
  it.each(page === 'browser' ? ["sidebar", "top"] as const : ["sidebar", "toolbox"] as const)(
    "selects the independent page from the %s menu", async (variant) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    const onPageChange = vi.fn();
    const open = vi.spyOn(window, "open");
    try {
      await act(async () => root.render(
        <DashboardNavigation page="accounts" onPageChange={onPageChange} t={t} variant={variant} />,
      ));
      const buttons = Array.from(container.querySelectorAll("button"));
      const button = buttons.find((item) => item.textContent === label);
      expect(button).toBeDefined();
      if (page === "coze") {
        const previousLabel = t(variant === "toolbox" ? "nav.skills" : "nav.tokenUsage");
        const previousIndex = buttons.findIndex((item) => item.textContent === previousLabel);
        expect(buttons[previousIndex + 1]).toBe(button);
      }
      if (page === "browser") {
        expect(buttons[buttons.findIndex(item => item.textContent === t('nav.codexGui')) + 1]).toBe(button);
        expect(container.querySelector('.sidebar-nav-tools')?.contains(button!)).not.toBe(true);
        const menu = buildDashboardMenuItems(t, true, true);
        const keys = menu.navigate?.map(item => item && 'key' in item ? item.key : undefined) ?? [];
        expect(keys[keys.indexOf('codex-gui') + 1]).toBe('browser');
        const searchIds = menu.search.map(item => item.id);
        expect(searchIds[searchIds.indexOf('codex-gui') + 1]).toBe('browser');
      }
      await act(async () => button?.click());
      expect(onPageChange).toHaveBeenCalledWith(page);
      expect(open).not.toHaveBeenCalled();
      await act(async () => root.render(
        <DashboardNavigation page={page} onPageChange={onPageChange} t={t} variant={variant} collapsed />,
      ));
      expect(container.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe(label);
      expect(isToolboxPage(page)).toBe(page !== 'browser');
    } finally {
      await act(async () => root.unmount());
      open.mockRestore();
    }
  });
});
