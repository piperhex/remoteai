import { useContext, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import { DetailsWorkspace } from "../src/pages/codexGui/DetailsWorkspace";
import { DetailsContext } from "../src/pages/codexGui/detailsContext";
import { ConversationChangesButton } from "../src/pages/codexGui/ConversationChangesButton";
import { MessageLink } from "../src/pages/codexGui/MessageLink";
import { RichText } from "../src/pages/codexGui/RichText";
import { useThemeMode } from "../src/hooks/useThemeMode";
import { filePreviewApi, type FilePreviewData } from "../src/pages/codexGui/filePreview/api";
import { fileApi } from "../src/pages/codexGui/fileApi";
import { WebsitePreviewControls } from "./website-preview-controls";
import "../src/styles.css";
import "antd/dist/reset.css";

const params = new URLSearchParams(location.search);
const variant = params.get("kind") ?? "markdown";
const websiteOnly = variant === "website" || variant === "links";
const code: Record<string, string> = {
  yaml: 'name: preview\nenabled: true\nsteps:\n  - run: "echo hello"\n',
  rs: 'pub fn greet(name: &str) -> String {\n    format!("Hello, {name}")\n}\n',
  ps1: '$greeting = "Hello"\nWrite-Host $greeting\n',
  py: 'def greet(name):\n    return f"Hello, {name}"\n',
  swift: 'func greet(name: String) -> String { return "Hello" }',
  dockerfile: 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\n',
  ts: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n',
};
const markdown = '# 项目说明\n\n支持 **Markdown**、表格和公式 $E=mc^2$。\n\n'
  + '| 格式 | 支持 |\n| --- | --- |\n| YAML | 语言高亮 |\n| 视频 | 播放和拖动 |\n\n'
  + '```typescript\nconst enabled: boolean = true;\n```\n\n'
  + '[配置文件](settings.yaml#L2) · [许可证](LICENSE)\n\n![示例图](preview-sample.svg)';
const html = '<!doctype html><html><head><link rel="stylesheet" href="preview-sample.css"></head>'
  + '<body><h1>HTML 预览</h1><button onclick="this.textContent=\'已点击\'">试一试</button>'
  + '<script>try{parent.document.body.dataset.leaked="yes"}catch{document.body.dataset.isolated="yes"}</script>'
  + '</body></html>';
const data: FilePreviewData = {
  sessionId: "fixture-preview",
  path: `C:/project/docs/example.${variant}`, name: `example.${variant}`, kind: "text",
  text: code[variant] ?? "Unknown extension text", url: new URL("./fixtures/preview-sample.html", location.href).href,
};
if (variant === "markdown") Object.assign(data, { kind: "markdown", text: markdown, name: "项目说明.md",
  path: "C:/project/docs/项目说明.md", url: new URL("./fixtures/README.md", location.href).href });
if (variant === "html") Object.assign(data, { kind: "html", text: html, name: "示例.html" });
if (variant === "video") Object.assign(data, { kind: "video", text: null, name: "演示视频.mp4",
  url: new URL("./fixtures/video-preview.mp4", location.href).href });
if (variant === "image") Object.assign(data, { kind: "image", text: null, name: "预览.svg",
  url: new URL("./fixtures/preview-sample.svg", location.href).href });
if (variant === "badVideo") Object.assign(data, { kind: "video", text: null, name: "损坏的视频.mp4",
  url: new URL("./fixtures/preview-sample.svg", location.href).href });
if (variant === "large") Object.assign(data, { text: "export const enabled = true;\n".repeat(12_000),
  path: "C:/project/large.ts", line: 180 });
if (params.has("dark")) localStorage.setItem("codex-switch:theme-mode", "dark");
else localStorage.setItem("codex-switch:theme-mode", "light");
const native = params.has("native");
if (!native && !params.has("hosted")) {
  Object.defineProperty(globalThis, "isTauri", { value: !websiteOnly, configurable: true });
  filePreviewApi.open = async target => {
    document.body.dataset.opened = JSON.stringify(target);
    if (target.path.endsWith("LICENSE")) return { ...data, ...target, sessionId: crypto.randomUUID(),
      name: "LICENSE", kind: "text", text: "Apache License 2.0" };
    return target.path.endsWith("settings.yaml") ? { ...data, sessionId: crypto.randomUUID(), ...target,
      name: "settings.yaml", kind: "text", text: code.yaml } : { ...data, sessionId: crypto.randomUUID() };
  };
  filePreviewApi.close = async id => { document.body.dataset.closed = id; };
  fileApi.applications = async () => [{ id: "vscode", name: "VS Code", kind: "editor" }];
  fileApi.perform = async (target, action) => {
    document.body.dataset.action = JSON.stringify({ target, action });
    return { path: target.path, saved: false, text: data.text ?? undefined };
  };
}
function Conversation() {
  const panel = useContext(DetailsContext);
  const openFile = panel?.openFile;
  useEffect(() => {
    if (!websiteOnly && !params.has("manual")) {
      void openFile?.({ path: params.get("path") ?? data.path, threadId: null });
    }
  }, [openFile]);
  return <div style={{ padding: 24 }}>
    <ConversationChangesButton />
    <h1>对话</h1>
    {variant === "links" && <RichText text={"前端 **http://localhost:3002**、后端 **http://127.0.0.1:8082** "
      + "均保持运行。本轮发现的问题尚未修复。"} />}
    <p><MessageLink href={params.get("path") ?? data.path}>查看文件</MessageLink></p>
    <p><MessageLink href={params.get("website")
      ?? (native ? "https://example.com" : `${location.origin}/e2e/fixtures/preview-sample.html`)}>
      查看网页</MessageLink></p>
    {variant === "website" && <WebsitePreviewControls />}
  </div>;
}
function Harness() {
  const { mode } = useThemeMode();
  return <ConfigProvider theme={{ algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <div style={{ height: "100vh" }}><DetailsWorkspace selected="fixture" active>
      <Conversation />
    </DetailsWorkspace></div>
  </ConfigProvider>;
}
document.body.style.minWidth = "0";
createRoot(document.getElementById("root")!).render(<Harness />);
