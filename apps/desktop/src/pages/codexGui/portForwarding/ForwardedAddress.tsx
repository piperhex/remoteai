import { useContext, useEffect, useState } from 'react';
import { Dropdown } from 'antd';
import { ChevronDown } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { DetailsContext } from '../../../../../../shared/conversation/detailsContext';
import { openWebsiteInBrowser } from '../../../../../../shared/conversation/WebsiteLinkMenu';
import styles from './portForwarding.module.less';

export function ForwardedAddress({ port, running, onOpen }: {
  port: number; running: boolean; onOpen: () => void;
}) {
  const panel = useContext(DetailsContext);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!running) setOpen(false); }, [running]);
  const address = `127.0.0.1:${port}`;
  const url = `http://${address}`;
  return <Dropdown trigger={['click']} disabled={!running} open={running && open} onOpenChange={setOpen}
    overlayStyle={{ maxWidth: 400, overflowWrap: 'anywhere' }}
    menu={{ items: [
      { key: 'preview', label: t("client.portForwarding.previewInRemoteAi"), disabled: !panel,
        onClick: () => { panel?.openWebsite(url, { resolved: true }); onOpen(); } },
      { key: 'browser', label: t("client.workspaceActions.openInBrowser"),
        onClick: () => { void openWebsiteInBrowser(url); onOpen(); } },
    ] }}>
    <button type="button" className={styles.address} disabled={!running} aria-haspopup="menu">
      <code>{address}</code>{running && <ChevronDown size={12} aria-hidden="true" />}
    </button>
  </Dropdown>;
}
