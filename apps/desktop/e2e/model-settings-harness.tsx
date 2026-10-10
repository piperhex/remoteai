import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { getGuiController, retainGuiSession } from "../src/pages/codexGui/session";
import { Messages } from "../src/pages/codexGui/Messages";
import { ModelPicker } from "../src/pages/codexGui/ModelPicker";
import { ComposerSubmit } from "../src/pages/codexGui/ComposerSubmit";
import { useUsageStatus } from "../src/pages/codexGui/useUsageStatus";
import { useGuiRequestSpeed } from "../src/pages/codexGui/useGuiRequestSpeed";

const controller = getGuiController();
function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [text, setText] = useState("");
  const [beats, setBeats] = useState(0);
  const { usage } = useUsageStatus(true);
  const speed = useGuiRequestSpeed(true);
  useEffect(() => { const stop = retainGuiSession(); void controller.connect(); return stop; }, []);
  useEffect(() => {
    const timer = setInterval(() => setBeats((count) => count + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ConfigProvider><main>
    <nav>{["a", "b"].map((id) => <button key={id} onClick={() => void controller.select(id)}>对话 {id}</button>)}
      <button onClick={controller.newConversation}>新对话</button></nav>
    <p>当前对话：<output aria-label="当前对话">{state.selected ?? "新对话"}</output></p>
    <output aria-label="刷新次数">{beats}</output>
    <p>{usage ? `用量 ${usage.totalTokens}` : "正在刷新用量"}</p>
    <p role="status" aria-label="模型同步">{state.modelSettingsLoading ? "正在同步模型设置" : "模型设置已同步"}</p>
    {!!state.error && <p role="alert">{state.error}</p>}
    <Messages selected={state.selected} value={state.selected ? state.conversations[state.selected] : undefined} />
    <section><textarea aria-label="聊天消息" value={text} onChange={(event) => setText(event.target.value)} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <ModelPicker models={state.models} {...state.settings} speed={speed} error={state.modelCatalogError}
          disabled={state.connection !== "ready" || Boolean(state.modelCatalogLoading)} onChange={controller.settings}
          onOpen={() => void controller.refreshModels().catch(controller.report)} />
        <ComposerSubmit state={state} controller={controller} hasDraft={Boolean(text.trim())}
          reading={Boolean(state.modelSettingsLoading || state.modelCatalogLoading)} onSend={async () => {
            if (await controller.send(text, [])) setText("");
          }} />
      </div>
    </section>
  </main></ConfigProvider>;
}
const css = document.createElement("style");
css.textContent = "body{font-family:sans-serif;background:#f5f6f5;margin:40px}main{max-width:800px;margin:auto}"
  + "section{margin-top:80px;background:white;padding:20px;border-radius:16px}textarea{width:100%;height:80px}"
  + ":root{--ink:#233329;--panel:#fff;--line:#dfe6e1;--muted:#66796d;--green-soft:#e7f4ec}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
