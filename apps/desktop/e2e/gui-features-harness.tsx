import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { CodexGuiPage } from "../src/pages/CodexGuiPage";
import { GuiWorkspace } from "../src/pages/codexGui/GuiWorkspace";
import { useGuiComputers } from "../src/pages/codexGui/remote/useGuiComputers";
import { DEMO_ACCOUNTS } from "../src/demo";
import { translate, type Translate } from "../src/i18n";
import "antd/dist/reset.css";
import "../src/styles.css";

const dark = new URLSearchParams(location.search).has("dark");
document.documentElement.dataset.theme = dark ? "dark" : "light";
const t: Translate = (key, values) => translate("zh", key, values);
const plugins = { authenticated: false, onLogin: () => {}, notify: () => {}, t };
function Harness() {
  const computers = useGuiComputers({ active: false, identity: null, login: () => {} });
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm],
    token: { fontSize: 14, colorPrimary: "#28837f" } }}><App>
    <div style={{ height: "100vh" }}>{new URLSearchParams(location.search).has('accounts')
      ? <GuiWorkspace active accounts={DEMO_ACCOUNTS} providers={[]} privacyMode={false} loading={false}
          computers={computers} plugins={plugins} />
      : <CodexGuiPage active accountPicker={null} providers={[]} aggregateApis={[]} plugins={plugins} />}</div>
    <output aria-label="刷新次数" hidden>{beats}</output>
  </App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
