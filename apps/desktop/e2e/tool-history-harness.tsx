import { Profiler, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { Messages } from "../src/pages/codexGui/Messages";
import { AsyncQuestions } from "../src/pages/codexGui/AsyncQuestions";
import { TurnMessage } from "../src/pages/codexGui/TurnMessage";
import type { Conversation } from "../src/pages/codexGui/types";
import queueStyles from "../src/pages/codexGui/QueuedMessages.module.less";
import styles from "../src/pages/codexGui/styles.module.less";

const full = new URLSearchParams(location.search).has("full");
function Harness() {
  const [value, setValue] = useState<Conversation>();
  const [active, setActive] = useState(true);
  const [dark, setDark] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { void fetch("/history-fixture.json").then((response) => response.json()).then(setValue); }, []);
  useEffect(() => {
    const update = (event: Event) => setValue((event as CustomEvent<Conversation>).detail);
    window.addEventListener("conversation-fixture", update);
    return () => window.removeEventListener("conversation-fixture", update);
  }, []);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <App><div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav><button onClick={() => setActive(!active)}>{active ? "离开对话" : "返回对话"}</button>
      <button onClick={() => setDark(!dark)}>切换主题</button></nav>
    <main className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1 }}>
      <div className={styles.workspace} hidden={!active}>
        <Profiler id="history" onRender={(_, __, duration) => {
          if (value) document.body.dataset.renderMs = String(Math.max(duration,
            Number(document.body.dataset.renderMs ?? 0)));
        }}>
          {full ? value?.turns.map((turn) => <TurnMessage key={turn.id} turn={turn} running={false} active={active} />)
            : <Messages selected={value?.thread.id ?? null} value={value} active={active}
              footer={<><AsyncQuestions value={value} onAnswer={async (item, answers) => {
                const response = await fetch("/async-answer", { method: "POST", body: JSON.stringify({ item, answers }) });
                return response.ok;
              }} /><div className={styles.composerWrap}>
                <div className={queueStyles.queue} aria-label="待发送消息">
                  待发送 · 1
                </div>
                <div className={styles.composer}>
                  <input aria-label="消息" placeholder="输入消息…" style={{ padding: 12 }} />
                </div>
              </div></>} />}
        </Profiler>
      </div>
    </main>
  </div></App></ConfigProvider>;
}

const css = document.createElement("style");
css.textContent = "*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}"
  + "[hidden]{display:none!important}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;"
  + "--muted:#66796d;--green:#168348;--green-dark:#126a3b;--green-soft:#e7f4ec}"
  + ":root[data-theme=dark]{color-scheme:dark;--ink:#e6e8eb;--muted:#9298a1;--line:#2b2f33;--panel:#17191c}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
