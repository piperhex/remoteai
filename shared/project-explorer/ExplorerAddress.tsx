import { useMemo, useState } from 'react';
import { Dropdown } from 'antd';
import { ChevronRight, Monitor, MoreHorizontal } from 'lucide-react';
import { pathParts, textKey, type Translate } from './model';
import { useAddressOverflow } from './useAddressOverflow';

interface AddressProps {
  directory: string;
  navigate: (path: string) => void;
  busy: boolean;
  t: Translate;
}

function AddressBreadcrumbs({ directory, navigate, busy, t }: AddressProps) {
  const computer = t(textKey('computer'));
  const parts = useMemo(() => [{ name: computer, path: '' }, ...(directory ? pathParts(directory) : [])],
    [computer, directory]);
  const { container, measurement, hidden } = useAddressOverflow(parts);
  const overflowIcon = <MoreHorizontal size={16} aria-hidden="true" />;
  return <nav ref={container} className="pe-address-path" aria-label={t(textKey('address'))}>
    <div className="pe-address-crumbs">
      {hidden > 0 && <span className="pe-crumb pe-crumb-overflow">
        <ChevronRight size={15} aria-hidden="true" />
        <Dropdown trigger={['click']} disabled={busy} overlayClassName="pe-menu"
          menu={{ items: parts.slice(0, hidden).map(part => ({ key: part.path, label: part.name })),
            onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); navigate(key); } }}>
          <button type="button" className="pe-crumb-label" disabled={busy}
            aria-label={t(textKey('more'))}>{overflowIcon}</button>
        </Dropdown>
      </span>}
      {parts.slice(hidden).map((part, index) => <span className="pe-crumb" key={part.path}>
        {(hidden > 0 || index > 0) && <ChevronRight size={15} aria-hidden="true" />}
        <button type="button" className="pe-crumb-label" disabled={busy} title={part.path || part.name}
          aria-current={hidden + index === parts.length - 1 ? 'location' : undefined}
          onClick={() => navigate(part.path)}><span className="pe-crumb-name">{part.name}</span></button>
      </span>)}
    </div>
    <div ref={measurement} className="pe-address-measure" aria-hidden="true">
      {parts.map((part, index) => <span className="pe-crumb" key={part.path}>
        {index > 0 && <ChevronRight size={15} />}
        <span className="pe-crumb-label"><span className="pe-crumb-name">{part.name}</span></span>
      </span>)}
      <span className="pe-crumb"><ChevronRight size={15} />
        <span className="pe-crumb-label">{overflowIcon}</span></span>
    </div>
  </nav>;
}

export function ExplorerAddress(props: AddressProps) {
  const { directory, navigate, busy, t } = props;
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(directory);
  const edit = () => { if (!busy) { setAddress(directory); setEditing(true); } };
  return <div className="pe-address" onClick={event => {
    // Breadcrumb controls navigate; all remaining space, including separators, edits the full path.
    if (!(event.target as Element).closest('button, form, [role="menu"]')) edit();
  }}>
    <Monitor size={19} aria-hidden="true" />
    {editing ? <form onSubmit={event => {
      event.preventDefault(); if (!busy) { navigate(address.trim()); setEditing(false); }
    }}><input autoFocus aria-label={t(textKey('address'))} value={address} disabled={busy}
      onFocus={event => event.target.select()} onChange={event => setAddress(event.target.value)}
      onBlur={() => setEditing(false)} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
      }} /></form> : <>
      <AddressBreadcrumbs {...props} />
      <button type="button" className="pe-address-edit" disabled={busy}
        aria-label={t(textKey('address'))} onClick={edit} />
    </>}
  </div>;
}
