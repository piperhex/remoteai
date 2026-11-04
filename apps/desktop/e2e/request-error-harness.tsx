import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Messages } from "../src/pages/codexGui/Messages";
import { conversation, reduceConversation } from "../../../shared/conversation/events";
import styles from "../../../shared/conversation/styles.module.less";

const REFRESH_MS = 100;
const initial = reduceConversation(conversation({ id: "test", cwd: "", preview: "", updatedAt: 1,
  turns: [{ id: "first", status: "inProgress", items: [
    { id: "question", type: "userMessage", content: [{ type: "text", text: "请检查连接" }] },
    { id: "before", type: "agentMessage", phase: "commentary", text: "正在检查连接，这是中断前的进度。" },
  ] }] }), { method: "error", params: { turnId: "first", willRetry: true,
  error: { message: "HTTP 502 Bad Gateway", additionalDetails: `upstream timed out\n${"response".repeat(100)}` } } });

function Harness() {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => setValue((current) => reduceConversation(current, {
      method: "thread/tokenUsage/updated", params: { tokenUsage: {
        total: { totalTokens: current.tokens + 1 }, last: { totalTokens: 1 },
      } },
    })), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const resume = () => setValue((current) => reduceConversation(current, { method: "item/completed", params: {
    turnId: "first", item: { id: "after", type: "agentMessage", phase: "commentary",
      text: "连接已恢复，正在继续检查。" },
  } }));
  const nextReply = () => setValue((current) => {
    const completed = reduceConversation(current, { method: "turn/completed", params: {
      turn: { id: "first", status: "completed", items: [
        { id: "final", type: "agentMessage", phase: "final_answer", text: "连接检查完成。" },
      ] },
    } });
    return reduceConversation(completed, { method: "turn/started", params: {
      turn: { id: "second", status: "inProgress", items: [] },
    } });
  });
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav><button onClick={resume}>恢复连接</button><button onClick={nextReply}>继续对话</button>
      <output aria-label="刷新次数">{value.tokens}</output></nav>
    <main className={`${styles.page} ${styles.collapsed}`} style={{ flex: 1 }}>
      <div className={styles.workspace}>
        <Messages selected="test" value={value} footer={<input aria-label="消息" />} />
      </div>
    </main>
  </div>;
}

const css = document.createElement("style");
css.textContent = "*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}"
  + ":root{--ink:#233329;--panel:#fff;--line:#dfe6e1;--muted:#66796d;--green:#168348}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
