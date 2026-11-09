// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MAX_TERMINAL_TABS, useTerminalPanel, type TerminalPanelState } from "../../../../../../shared/terminal/views/useTerminalPanel";
import { terminalTheme } from "../../../../../../shared/terminal/views/theme";

it("preserves shells across hiding and project changes, and creates new tabs in the current project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let panel!: TerminalPanelState;
  function Fixture({ cwd }: { cwd: string }) { panel = useTerminalPanel(cwd); return null; }
  try {
    await act(async () => root.render(<Fixture cwd="D:/first" />));
    await act(async () => panel.toggle());
    const first = panel.tabs[0];
    await act(async () => panel.hide());
    expect(panel.open).toBe(false);
    expect(panel.tabs).toEqual([first]);
    await act(async () => root.render(<Fixture cwd="D:/second" />));
    await act(async () => panel.toggle());
    expect(panel.tabs).toEqual([first]);
    await act(async () => panel.add());
    expect(panel.tabs.map((tab) => tab.cwd)).toEqual(["D:/first", "D:/second"]);
    await act(async () => panel.remove(panel.selected));
    expect(panel.selected).toBe(first.id);
    await act(async () => panel.remove(first.id));
    expect(panel.open).toBe(false);
    expect(panel.tabs).toEqual([]);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it("uses opaque black in dark mode and white in light mode", () => {
  expect(terminalTheme(true).background).toBe("#000000");
  expect(terminalTheme(false).background).toBe("#ffffff");
});

it('removes a group atomically, preserves surviving selection and selects a survivor when needed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useTerminalPanel>;
  function Fixture() { panel = useTerminalPanel('C:/project'); return null; }
  try {
    await act(async () => root.render(<Fixture />));
    await act(async () => { for (let index = 0; index < 4; index++) panel.add(); });
    const ids = panel.tabs.map(tab => tab.id);
    await act(async () => panel.select(ids[0]));
    await act(async () => panel.removeTabs(ids.slice(2)));
    expect(panel.tabs.map(tab => tab.id)).toEqual(ids.slice(0, 2));
    expect(panel.selected).toBe(ids[0]);
    expect(panel.open).toBe(true);
    await act(async () => panel.removeTabs([ids[0]]));
    expect(panel.selected).toBe(ids[1]);
    await act(async () => panel.removeTabs([ids[1]]));
    expect(panel.tabs).toEqual([]);
    expect(panel.selected).toBe('');
    expect(panel.open).toBe(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it('prevents duplicate script starts and allows restarting after exit without touching other scripts', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useTerminalPanel>;
  function Fixture() { panel = useTerminalPanel('C:/project'); return null; }
  try {
    await act(async () => root.render(<Fixture />));
    await act(async () => {
      panel.addInDirectory('C:/project', 'dev');
      panel.addInDirectory('C:/project', 'dev');
    });
    expect(panel.tabs).toHaveLength(1);
    const first = panel.tabs[0].id;
    await act(async () => panel.addInDirectory('C:/project/child', 'dev'));
    expect(panel.tabs).toHaveLength(2);
    await act(async () => panel.exited(first));
    await act(async () => panel.addInDirectory('C:/project', 'dev'));
    expect(panel.tabs).toHaveLength(3);
    expect(panel.tabs[0].exited).toBe(true);
    expect(panel.tabs[1].exited).toBeUndefined();
    await act(async () => panel.remove(panel.selected));
    expect(panel.tabs.map(tab => tab.cwd)).toEqual(['C:/project', 'C:/project/child']);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it('adds and selects a fresh tab in the requested directory, including when hidden', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  let panel!: TerminalPanelState;
  function Fixture() { panel = useTerminalPanel('C:/project'); return null; }
  try {
    await act(async () => root.render(<Fixture />));
    for (let index = 0; index < MAX_TERMINAL_TABS; index++) {
      const existing = [...panel.tabs];
      await act(async () => panel.addInDirectory('C:/project/src'));
      expect(panel.tabs.slice(0, -1)).toEqual(existing);
      expect(panel.tabs.at(-1)?.cwd).toBe('C:/project/src');
      expect(panel.selected).toBe(panel.tabs.at(-1)?.id);
      expect(panel.open).toBe(true);
      await act(async () => panel.hide());
    }
    await act(async () => panel.addInDirectory('C:/project/src'));
    expect(panel.tabs).toHaveLength(MAX_TERMINAL_TABS);
    expect(panel.open).toBe(true);
    expect(panel.error).toBe('client.terminal.closeATerminalBeforeOpeningAnotherOne');
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
