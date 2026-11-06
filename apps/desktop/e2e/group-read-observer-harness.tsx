import { createRoot } from 'react-dom/client';
import { LoungeController } from '../../../shared/lounge/controller';
import { useGroupReadObserver } from '../../../shared/lounge/useGroupReadObserver';
import type { LoungeMessage } from '../../../shared/lounge/types';

declare global { interface Window { groupReadObserverFixture: {
  events: { visible: boolean; history: boolean; at: number }[];
  unmount: () => void;
} } }

const parameters = new URLSearchParams(location.search);
const controller = new LoungeController();
const initial = controller.snapshot();
controller.snapshot = () => ({ ...initial, user: { id: 'self', account: 'self' } });
const root = createRoot(document.getElementById('root')!);
window.groupReadObserverFixture = { events: [], unmount: () => root.unmount() };
controller.setGroupMessageVisible = ({ visible, history = false }) => {
  window.groupReadObserverFixture.events.push({ visible, history, at: performance.now() });
};
const message: LoungeMessage = {
  type: 'message', id: 'observed', text: 'Observer regression', images: [], sentAt: new Date().toISOString(),
  sender: { id: parameters.has('own') ? 'self' : 'manager', account: 'manager' },
  groupReceipt: parameters.has('unsupported') ? undefined : 'signed-capability',
  recipient: parameters.has('direct') ? { id: 'self', account: 'self' } : undefined,
};

function Fixture() {
  const ref = useGroupReadObserver({ message, controller, history: parameters.has('history') });
  const containerHeight = Number(parameters.get('container'));
  return <div id="clip-root" style={parameters.has('clip')
    ? { height: 120, width: 200, overflow: 'hidden' } : undefined}>
    <div id="scroll-root" style={containerHeight
      ? { height: containerHeight, width: 600, overflow: 'auto' } : undefined}>
      <div id="spacer" style={{ height: 900 }} />
      <div ref={ref} id="message" style={{ height: Number(parameters.get('height') ?? 1800), width: 400,
        background: '#eef4ff' }}>{message.text}</div>
      <div style={{ height: 1800 }} />
    </div>
  </div>;
}
root.render(<Fixture />);
