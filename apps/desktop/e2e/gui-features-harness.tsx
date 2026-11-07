import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { CodexGuiPage } from "../src/pages/CodexGuiPage";
import { translate, type Translate } from "../src/i18n";
import "antd/dist/reset.css";
import "../src/styles.css";

const dark = new URLSearchParams(location.search).has("dark");
document.documentElement.dataset.theme = dark ? "dark" : "light";
const t: Translate = (key, values) => translate("zh", key, values);
function Harness() {
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm],
    token: { fontSize: 14, colorPrimary: "#28837f" } }}><App>
    <div style={{ height: "100vh" }}><CodexGuiPage active accountPicker={null} providers={[]} aggregateApis={[]}
      plugins={{ authenticated: false, onLogin: () => {}, notify: () => {}, t }} /></div>
    <output aria-label="刷新次数" hidden>{beats}</output>
  </App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
