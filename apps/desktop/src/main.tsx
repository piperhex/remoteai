import React from "react";
import './nativeRtc/install';
import ReactDOM from "react-dom/client";
import App from "./App";
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { installBrowserDefaultsGuard } from '../../../shared/browser/installBrowserDefaultsGuard';
import { refreshTokenCostPresetsOnce, subscribeToTokenCostPresetStorage } from "./utils/tokenCostPresetStartup";
import { RemoteChatHost } from "./remoteChat/useChatHost";
import { startRemoteUpdateBridge } from "./remoteUpdate/bridge";
import { applyThemeMode, loadThemeMode } from "./utils/themeMode";
import "antd/dist/reset.css";
import "./styles.css";

applyThemeMode(loadThemeMode());
const stopBrowserDefaultsGuard = installBrowserDefaultsGuard();
if (import.meta.hot) import.meta.hot.dispose(stopBrowserDefaultsGuard);

function normalizeWindowRoute(value: string | null) {
  return (value ?? "").replace(/^#\/?/, "").split(/[?#]/)[0];
}

function windowRoute() {
  const queryWindow = normalizeWindowRoute(new URLSearchParams(window.location.search).get("window"));
  const hashWindow = normalizeWindowRoute(window.location.hash);
  return queryWindow || hashWindow;
}

const currentWindowRoute = windowRoute();
if (!currentWindowRoute && '__TAURI_INTERNALS__' in window) {
  const updates = startRemoteUpdateBridge();
  void updates.catch((error: unknown) => console.error('Could not start remote updates', error));
  if (import.meta.hot) import.meta.hot.dispose(() => { void updates.then((stop) => stop()); });
}
const stopPresetStorage = subscribeToTokenCostPresetStorage();
if (!currentWindowRoute && '__TAURI_INTERNALS__' in window) void refreshTokenCostPresetsOnce();
if (import.meta.hot) import.meta.hot.dispose(stopPresetStorage);
document.documentElement.classList.toggle("floating-usage-page", currentWindowRoute === "bubble");
document.documentElement.classList.toggle("token-usage-page", currentWindowRoute === "token-usage");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {!currentWindowRoute && '__TAURI_INTERNALS__' in window && <RemoteChatHost />}
    <ApplicationTypography><App /></ApplicationTypography>
  </React.StrictMode>,
);
