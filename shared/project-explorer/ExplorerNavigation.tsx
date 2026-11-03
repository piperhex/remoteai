import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Monitor, RefreshCw, Search } from 'lucide-react';
import { pathParts, textKey, type Translate } from './model';
import type { ExplorerState } from './useExplorer';

export function ExplorerNavigation({ state, t, busy }: { state: ExplorerState; t: Translate; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(state.directory);
  useEffect(() => { setAddress(state.directory); }, [state.directory]);
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
    <div className="pe-address" onDoubleClick={() => { if (!busy) setEditing(true); }}>
      <Monitor size={19} aria-hidden="true" />
      {editing ? <form onSubmit={event => {
        event.preventDefault(); if (!busy) { state.navigate(address.trim()); setEditing(false); }
      }}><input autoFocus aria-label={t(textKey('address'))} value={address} disabled={busy}
        onFocus={event => event.target.select()} onChange={event => setAddress(event.target.value)}
        onBlur={() => setEditing(false)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
        }} /></form> : <>
        <nav aria-label={t(textKey('address'))}>
          <button type="button" disabled={busy} onClick={() => state.navigate('')}>{t(textKey('computer'))}</button>
          {state.directory && pathParts(state.directory).map(part => <span key={part.path}>
            <ChevronRight size={15} aria-hidden="true" /><button type="button" disabled={busy}
              onClick={() => state.navigate(part.path)}>{part.name}</button></span>)}
        </nav><button type="button" className="pe-address-edit" disabled={busy}
          aria-label={t(textKey('address'))} onClick={() => setEditing(true)}><ChevronRight size={15} /></button>
      </>}
    </div>
    <label className="pe-search"><input type="search" value={state.query} disabled={busy}
      aria-label={t(textKey('search'))} placeholder={t(textKey('search'))}
      onChange={event => state.setQuery(event.target.value)} /><Search size={18} aria-hidden="true" /></label>
  </div>;
}
