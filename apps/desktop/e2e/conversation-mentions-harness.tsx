import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SkillInput } from "../src/pages/codexGui/SkillInput";
import { ComposerReferences } from "../src/pages/codexGui/ComposerReferences";
import { GuiController } from "../src/pages/codexGui/controller";
import { useComposerDraft } from "../src/pages/codexGui/useComposerDraft";
import { guiApi } from "../../../shared/conversation/api";
import type { Request, Thread } from "../../../shared/conversation/types";

const threads: Thread[] = [
  { id: "current", name: "当前对话", preview: "", cwd: "F:/project", updatedAt: 3 },
  { id: "design", name: "首页设计方案", preview: "", cwd: "F:/design", updatedAt: 2, status: { type: "idle" } },
  { id: "build", name: "修复登录并验证桌面与手机上的登录流程", preview: "", cwd: "F:/app", updatedAt: 1,
    status: { type: "active" } },
];
const controller = new GuiController();
controller.send = async (text, images, skills, attachments) => {
  document.body.dataset.sent = JSON.stringify({ text, images, skills, attachments });
  return true;
};
let pending = 0;
let maxPending = 0;
guiApi.request = async <T,>(request: Request): Promise<T> => {
  if (request.operation === 'projectFiles') return { directory: 'F:/project', parent: null, truncated: false,
    entries: [
      { name: 'robot', path: 'F:/project/service_business/log/src/main/java/com/robot', directory: true,
        relativePath: 'service_business/log/src/main/java/com/robot' },
      { name: 'RobotService.java', path: 'F:/project/src/RobotService.java', directory: false,
        relativePath: 'src/RobotService.java' },
    ] } as T;
  if (request.operation !== "list") throw new Error("Unexpected request");
  maxPending = Math.max(maxPending, ++pending);
  document.body.dataset.maxPending = String(maxPending);
  const delay = Number(new URLSearchParams(location.search).get("delay") ?? 0);
  await new Promise((resolve) => setTimeout(resolve, delay));
  pending--;
  return { data: threads, nextCursor: null } as T;
};

function Harness() {
  const [draftKey, setDraftKey] = useState("current");
  const [beats, setBeats] = useState(0);
  const draft = useComposerDraft(draftKey, controller);
  useEffect(() => {
    const timer = setInterval(() => setBeats((value) => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <main><h2>对话引用</h2><p>输入 @ 选择其他对话，带上近期内容继续讨论。</p>
    <button onClick={() => setDraftKey(draftKey === "current" ? "other" : "current")}>切换对话</button>
    <output aria-label="刷新次数">{beats}</output>
    <section>
      <ComposerReferences items={draft.draft.attachments ?? []} disabled={false} onRemove={draft.removeAttachment} />
      <SkillInput value={draft.draft} draftKey={draftKey} cwd="F:/project" active connected disabled={false}
        conversations={{ selected: draftKey, threads: [], conversations: {} }}
        onConversation={(reference) => draft.addAttachments([reference])} placeholder="描述任务，@ 引用对话…"
        onFile={reference => draft.addAttachments([reference])}
        onChange={draft.editContent} onPaste={draft.paste} onSend={() => void draft.send()} />
      <button onClick={() => void draft.send()}>发送</button>
    </section>
  </main>;
}
const css = document.createElement("style");
css.textContent = "body{font-family:system-ui,sans-serif;background:#f5f6f5;margin:24px;color:#233329}"
  + "main{max-width:760px;margin:auto}section{margin-top:320px;background:white;padding:12px;border-radius:16px}"
  + "output{margin-left:16px}:root{--ink:#233329;--panel:#fff;--line:#dfe6e1;--muted:#66796d;"
  + "--gui-muted:#66796d;--gui-border:#dfe6e1;--green-selection:#e7f4ec;--bg:#f5f6f5}";
document.head.append(css);
createRoot(document.getElementById("root")!).render(<Harness />);
