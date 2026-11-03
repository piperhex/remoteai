import { ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Search } from 'lucide-react';
import { textKey, type Translate } from './model';
import type { ExplorerState } from './useExplorer';
import { ExplorerAddress } from './ExplorerAddress';

export function ExplorerNavigation({ state, t, busy }: { state: ExplorerState; t: Translate; busy: boolean }) {
  const buttons = [
    { key: 'back', icon: ArrowLeft, disabled: !state.canBack, click: () => state.travel(-1) },
    { key: 'forward', icon: ArrowRight, disabled: !state.canForward, click: () => state.travel(1) },
    { key: 'up', icon: ArrowUp, disabled: state.result?.parent == null,
      click: () => state.navigate(state.result?.parent ?? '') },
    { key: 'refresh', icon: RefreshCw, disabled: false, click: state.refresh },
  ];
  return <div className="pe-navigation">
    <div className="pe-nav-buttons">{buttons.map(button => <button type="button" key={button.key}
      aria-label={t(textKey(button.key))} title={t(textKey(button.key))}
      disabled={busy || button.disabled} onClick={button.click}>
      <button.icon size={19} aria-hidden="true" /></button>)}</div>
    <ExplorerAddress directory={state.directory} navigate={state.navigate} busy={busy} t={t} />
    <label className="pe-search"><input type="search" value={state.query} disabled={busy}
      aria-label={t(textKey('search'))} placeholder={t(textKey('search'))}
      onChange={event => state.setQuery(event.target.value)} /><Search size={18} aria-hidden="true" /></label>
  </div>;
}
