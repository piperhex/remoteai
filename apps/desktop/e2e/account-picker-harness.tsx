import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { DEMO_ACCOUNTS } from "../src/demo";
import type { Provider } from "../src/types";
import { ProxyAccountPicker } from "../src/pages/codexGui/ProxyAccountPicker";
import { useUsageStatus } from "../src/pages/codexGui/useUsageStatus";
import { MessageItem } from "../src/pages/codexGui/MessageItem";
import { DetailsWorkspace } from "../../../shared/conversation/DetailsWorkspace";
import { SkillInput } from "../src/pages/codexGui/SkillInput";
import type { ComposerText } from "../../../shared/conversation/types";

const provider: Provider = {
  id: "backup", name: "备用服务", kind: "custom", group: "", baseUrl: "https://example.com/v1",
  model: "test-model", models: [], modelReasoningEfforts: {}, modelContextWindows: {}, modelApiFormats: {},
  imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: true,
  fastModeEnabled: false, apiFormat: "openaiResponses", active: false, autoSwitchEnabled: false,
  hasApiKey: true, supportsDirectSwitch: false, balanceQueryUsesApiKey: true, hasBalanceQueryToken: false,
  hasWalletQueryToken: false, hasWalletLoginCredentials: false,
};
const accountCount = new URLSearchParams(location.search).has("manyAccounts") ? 40 : 6;
const resetTime = Math.floor(Date.now() / 1_000);
const accounts = Array.from({ length: accountCount }, (_, index) => ({ ...DEMO_ACCOUNTS[index % DEMO_ACCOUNTS.length],
  id: `account-${index}`, email: `workspace${index + 1}@example.com`, active: index === 0, localProxyCompatible: true,
  autoSwitchEnabled: false, autoSwitchPriority: 20, autoSwitchThreshold: 50,
  usage: {
    primary: { usedPercent: 90 - index % 6 * 10, remainingPercent: 10 + index % 6 * 10,
      resetsAt: resetTime + 14_400 },
    secondary: { usedPercent: 25, remainingPercent: 75, resetsAt: resetTime + 172_800 },
  },
}));
const TICK_MS = 50;

function FontSample() {
  const [value, setValue] = useState<ComposerText>({ text: "输入消息…", mentions: [] });
  return <section aria-label="对话字号示例" style={{ position: "absolute", top: 60, left: 20, right: 20 }}>
    <DetailsWorkspace selected="font-sample" active>
      <MessageItem item={{ id: "reply", type: "agentMessage",
        text: "这是一条回复。\n\n```js\nconst message = 'Hello, Codex!';\n```" }} streaming={false} />
      <MessageItem item={{ id: "user", type: "userMessage", content: [{ type: "text", text: "你好，Codex。" }] }}
        streaming={false} />
      <SkillInput value={value} onChange={setValue} draftKey="sample" cwd="" active connected={false}
        disabled={false} placeholder="输入消息…" onPaste={() => {}} onSend={() => {}} />
    </DetailsWorkspace>
  </section>;
}

function Harness() {
  const [beats, setBeats] = useState(0);
  useUsageStatus(true);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider theme={{ token: { colorPrimary: "#168348" } }}><App>
    <main><input aria-label="消息" placeholder="输入消息…" /><output aria-label="刷新次数" hidden>{beats}</output></main>
    {new URLSearchParams(location.search).has("fontSample") && <FontSample />}
    <aside aria-label="会话侧栏">
      <ProxyAccountPicker active privacyMode={false} accounts={accounts} providers={[provider]}
        aggregateApis={[]} proxyRunning busy={false} loading={false}
        onSwitchAccount={async () => true} onSwitchProvider={async () => true} />
    </aside>
  </App></ConfigProvider>;
}

const css = document.createElement("style");
css.textContent = "*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif;background:#f4f7f5}"
  + "main{position:absolute;left:12px;top:12px}input{font:inherit}"
  + "aside{position:absolute;left:12px;bottom:12px;width:var(--fixture-sidebar-width,352px);"
  + "max-width:calc(100vw - 24px);padding:16px;background:#fff;--sidebar-inline-padding:16px;"
  + "--sidebar-bottom-padding:16px}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;"
  + "--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-selection:#c6f4e8;"
  + "--green-selection-hover:#e7f4ec}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
