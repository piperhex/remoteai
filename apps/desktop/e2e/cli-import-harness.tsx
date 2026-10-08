import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, ConfigProvider, Popover } from "antd";
import { mockIPC } from "@tauri-apps/api/mocks";
import { guiText, setGuiLanguage } from "../src/i18n/guiText";
import type { CliSnapshot } from "../src/pages/codexGui/cliManualDownloadApi";
import "antd/dist/reset.css";

const query = new URLSearchParams(location.search);
const language = query.get("language");
setGuiLanguage(language === "en" || language === "ru" ? language : "zh");
mockIPC(async (command, args) => {
  const options = args as { options?: { title?: string } };
  if (command === "plugin:dialog|open") {
    return options.options?.title === guiText("选择完整安装包")
      ? "C:\\Downloads\\codex-package-x86_64-pc-windows-msvc.tar.gz" : "C:\\Downloads\\rust-v0.161.0";
  }
  if (command === "codex_gui_cli_manual_download") return {
    platform: "Windows / x64", assetName: "codex-package-x86_64-pc-windows-msvc.tar.gz",
    packageUrl: "https://github.com/openai/codex/releases/latest/download/codex-package-x86_64-pc-windows-msvc.tar.gz",
    metadataUrl: "https://api.github.com/repos/openai/codex/releases/latest",
    releaseUrl: "https://github.com/openai/codex/releases/latest",
  };
  if (command === "codex_gui_cli_import") {
    const { request } = args as { request: { packagePath?: string; metadataPath?: string } };
    if (!request.packagePath || (query.has("package-only") && request.metadataPath)) {
      throw new Error("Unexpected import files");
    }
    await new Promise(resolve => setTimeout(resolve, 600));
    if (query.has("failure")) throw "安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。";
    return { version: "0.161.0", release: null };
  }
  throw new Error(`Unexpected fixture command: ${command}`);
});
const { Installer } = await import("../src/pages/codexGui/Installer");
function Fixture() {
  const [version, setVersion] = useState<string | null>(query.has("first") ? null : "0.160.0");
  const installer = { version, release: null, checking: false, installing: false, progress: null,
    checked: true, check: async () => {}, install: async () => {},
    onImported: async (value: CliSnapshot) => { setVersion(value.version); } };
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <main style={{ padding: 24, background: "#edf5fa", minHeight: "100vh" }}>
    {query.has("first") ? <Installer installer={installer} /> : <div style={{ textAlign: "right" }}>
      <Popover trigger="click" placement="bottomRight" styles={{ root: { maxWidth: 400 } }}
        content={<Installer installer={installer} compact />}>
        <Button>Codex v{version}</Button>
      </Popover>
    </div>}
  </main></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
