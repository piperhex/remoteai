import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatTokenSummary } from '../../web/src/chat/ChatTokenSummary';
import { demoTokenSummary } from './demo-token-summary';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import './token-native-observer';

let reads = 0;
Object.assign(window, { remoteReadCount: () => reads });
const read = async (weeks = 2) => {
  reads++;
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('probe_shared_read');
  } else await fetch(`/token-remote-fixture?weeks=${weeks}`);
  return { ...demoTokenSummary({ weeks }), refreshSeconds: 1 };
};
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open summary</button>
    {open && <ChatTokenSummary read={read} ready scope="token-lifecycle:account:computer"
      deviceName="Test computer" onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
