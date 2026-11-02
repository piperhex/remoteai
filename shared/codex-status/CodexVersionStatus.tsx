import { useState } from 'react';
import { Tooltip } from 'antd';
import type { MessageTranslator } from '../localization/messages';
import type { ReadCodexServiceStatus } from './status';
import { useCodexServiceStatus } from './useCodexServiceStatus';
import { StatusBrowser } from './StatusBrowser';
import './status.css';

export function CodexVersionStatus({ version, read, active, connected = true, t }: {
  version?: string | null; read?: ReadCodexServiceStatus; active: boolean; connected?: boolean; t: MessageTranslator;
}) {
  const status = useCodexServiceStatus(read, active && connected);
  const [open, setOpen] = useState(false);
  return <span className="codex-version-status">
    <span>Codex{version ? ` ${version}` : ''}</span><span aria-hidden="true">·</span>
    <Tooltip title={t(`client.codexStatus.${status}Hint`)} styles={{ root: { maxWidth: 400 } }}>
      <button type="button" className="codex-service-status" data-status={status}
        aria-label={t('client.codexStatus.open', { status: t(`client.codexStatus.${status}`) })}
        onClick={() => setOpen(true)}>
        <span className="codex-service-dot" aria-hidden="true" />{t(`client.codexStatus.${status}`)}
      </button>
    </Tooltip>
    {open && <StatusBrowser active={active} onClose={() => setOpen(false)} />}
  </span>;
}
