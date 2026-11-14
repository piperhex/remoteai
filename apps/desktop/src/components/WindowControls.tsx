import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import type { Translate } from "../i18n";

export function WindowControls({ onError, t }: { onError: (message: string) => void; t: Translate }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      void appWindow.isMaximized().then(value => {
        if (active) setMaximized(value);
      }).catch((error: unknown) => {
        if (active) onError(String(error));
      });
    };
    refresh();
    void appWindow.onResized(refresh).then(stop => {
      if (active) unlisten = stop;
      else stop();
    }).catch((error: unknown) => {
      if (active) onError(String(error));
    });
    return () => { active = false; unlisten?.(); };
  }, [onError]);

  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    void getCurrentWindow()[action]().then(() => {
      if (action === "toggleMaximize") {
        void getCurrentWindow().isMaximized().then(setMaximized).catch((error: unknown) => onError(String(error)));
      }
    }).catch((error: unknown) => onError(String(error)));
  };
  return (
    <div className="window-controls">
      <button type="button" className="window-control" aria-label={t("windowMenu.minimize")}
        onClick={() => run("minimize")}><Minus size={16} /></button>
      <button type="button" className="window-control" aria-label={t("windowMenu.maximize")}
        aria-pressed={maximized} onClick={() => run("toggleMaximize")}>
        {maximized ? <Copy size={15} /> : <Square size={13} />}
      </button>
      <button type="button" className="window-control window-control-close" aria-label={t("windowMenu.close")}
        onClick={() => run("close")}><X size={17} /></button>
    </div>
  );
}
