import { useEffect, useState } from "react";
import { GuiHostPicker } from "../../../shared/conversation/GuiHostPicker";
import { ChatDevices } from "../../../shared/remote-chat/views/ChatDevices";
import { ChatQueue } from "../../../shared/remote-chat/views/ChatQueue";

/** Real controls from both workspaces expose native-preview input and IPC regressions. */
export function WebsitePreviewControls() {
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState("");
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats(value => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <div style={{ maxWidth: 400 }}>
    <GuiHostPicker active navigation={{ current: null, devices: [], authenticated: false,
      loading: false, error: "", refresh() {}, login() {}, choose() {} }} />
    <button type="button" onClick={() => setPicking(true)}>选择电脑</button>
    {picking && <ChatDevices devices={[]} choose={() => setPicking(false)} onClose={() => setPicking(false)} />}
    <ChatQueue messages={[{ id: "queued", text: "预览期间的待发送消息", imageCount: 0, attachmentCount: 0,
      busy: false }]} running disabled={false} editDisabled={false} take={async () => undefined}
      act={async operation => setResult(operation)} edit={async () => setResult("edited")} />
    <output aria-label="操作结果">{result}</output>
    <output aria-label="界面心跳" hidden>{beats}</output>
  </div>;
}
