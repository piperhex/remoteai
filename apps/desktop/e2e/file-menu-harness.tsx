import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { FileMenu } from "../src/pages/codexGui/FileMenu";
import { EditedFilesSummary } from "../src/pages/codexGui/EditedFilesSummary";
import { FileThreadContext, fileApi, type FileApplication } from "../src/pages/codexGui/fileApi";
import { parseDiff } from "../src/pages/codexGui/diff";

const applications: FileApplication[] = [
  { id: "vscode", name: "VS Code", kind: "editor" },
  { id: "visualStudio", name: "Visual Studio", kind: "editor" },
  { id: "explorer", name: "文件管理器", kind: "system" },
  { id: "terminal", name: "终端", kind: "terminal" },
  { id: "gitBash", name: "Git Bash", kind: "terminal" },
  { id: "wsl", name: "WSL", kind: "terminal" },
  ...["Android Studio", "IntelliJ IDEA", "PyCharm", "WebStorm", "PhpStorm"].map((name) =>
    ({ id: name, name, kind: "editor" as const })),
  { id: "other", name: "其他应用…", kind: "system" },
];
const delay = Number(new URLSearchParams(location.search).get("delay") ?? 0);
Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
fileApi.applications = async () => {
  await new Promise(resolve => setTimeout(resolve, delay));
  if (new URLSearchParams(location.search).has("icons")) {
    return (await fetch("/e2e/file-menu-icons.json")).json() as Promise<FileApplication[]>;
  }
  return applications;
};
const dark = new URLSearchParams(location.search).has("dark");
const files = parseDiff("diff --git a/src/report.ts b/src/report.ts\n--- a/src/report.ts\n"
  + "+++ b/src/report.ts\n@@ -1 +1 @@\n-old\n+new\n");

function Harness() {
  const [result, setResult] = useState("");
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  fileApi.perform = async (target, action) => {
    setResult(JSON.stringify({ target, action }));
    return { path: target.path, saved: false };
  };
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}><App>
    <FileThreadContext.Provider value="fixture-thread">
      <main style={{ maxWidth: 760, margin: "40px auto", padding: 20, color: dark ? "#eee" : "#233329" }}>
        <p>已整理好文件，点击下方链接可选择打开方式。</p>
        <p><FileMenu path="C:/项目/季度报告.pdf" line={12}>季度报告.pdf</FileMenu></p>
        <EditedFilesSummary files={files} title="本轮修改" onReview={() => setResult("全部差异")}
          renderFile={props => <FileMenu {...props}>{props.path}</FileMenu>}
          onReviewFile={(path) => setResult(`差异：${path}`)} />
        <p><input aria-label="消息" placeholder="输入消息…" style={{ padding: 12, width: "80%" }} /></p>
        <output aria-label="操作结果">{result}</output><output aria-label="刷新次数" hidden>{beats}</output>
      </main>
    </FileThreadContext.Provider>
  </App></ConfigProvider>;
}
document.body.style.background = dark ? "#19211d" : "#f4f7f5";
document.documentElement.dataset.theme = dark ? "dark" : "light";
document.body.style.fontFamily = '"Microsoft YaHei", sans-serif';
document.documentElement.style.cssText = dark
  ? "--ink:#eee;--panel:#242c28;--gui-border:#48544c;--gui-muted:#acb9b0;--green:#79c496;--green-soft:#30463a"
  : "--ink:#233329;--panel:#fff;--gui-border:#dfe6e1;--gui-muted:#66796d;--green:#168348;--green-soft:#e7f4ec";
createRoot(document.getElementById("root")!).render(<Harness />);
