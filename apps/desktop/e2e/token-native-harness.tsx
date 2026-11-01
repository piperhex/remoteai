import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TokenUsagePanel } from '../src/components/TokenUsagePanel';
import '../src/styles.css';
import './token-query-harness';
import './token-native-observer';

window.__tokenMetrics = { entries: 0, daily: 0, breakdown: 0, quota: 0, renders: 0, draws: 0 };
window.__tokenCount = name => { window.__tokenMetrics[name]++; };
window.__tokenDelay = 40;
let usagePending = 0;
Object.assign(window, { usagePending: () => usagePending });
window.__tokenProbe = async (name, load) => {
  window.__tokenCount(name);
  usagePending++;
  try {
    await new Promise(resolve => setTimeout(resolve, window.__tokenDelay));
    return await load();
  } finally { usagePending--; }
};
function Harness() {
  const [active, setActive] = useState(false);
  const [weeks, setWeeks] = useState(2);
  return <><button onClick={() => setActive(value => !value)}>Toggle usage</button>
    <TokenUsagePanel active={active} language="en" themeColor="#32aaa7" weeks={weeks} refreshSeconds={1}
      onWeeksChange={value => { if (value) setWeeks(value); }} /></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
