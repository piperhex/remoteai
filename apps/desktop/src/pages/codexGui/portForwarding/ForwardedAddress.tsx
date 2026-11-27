import { useContext, useEffect, useState } from 'react';
import { Dropdown, type MenuProps } from 'antd';
import { ChevronDown } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { DetailsContext } from '../../../../../../shared/conversation/detailsContext';
import { BrowserNavigationContext } from '../../../../../../shared/browser/BrowserNavigationProvider';
import { openWebsiteInBrowser } from '../../../../../../shared/conversation/WebsiteLinkMenu';
import { localMappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry } from './service';
import styles from './portForwarding.module.less';

export function ForwardedAddress({ entry, onOpen }: { entry: ForwardingEntry; onOpen?: () => void }) {
  const panel = useContext(DetailsContext);
  const browser = useContext(BrowserNavigationContext);
  const preview = panel ?? browser;
  const [open, setOpen] = useState(false);
  const running = entry.status === 'running';
  useEffect(() => { if (!running) setOpen(false); }, [running]);
  const address = localMappingAddress(entry);
  const url = `http://${address}`;
  const items: MenuProps['items'] = [
    { key: 'preview', label: t("client.portForwarding.previewInRemoteAi"), disabled: !preview,
      onClick: () => { preview?.openWebsite(url, { resolved: true }); onOpen?.(); } },
  ];
  if (!entry.localDomain) {
    items.push({ key: 'browser', label: t("client.workspaceActions.openInBrowser"),
      onClick: () => { void openWebsiteInBrowser(url); onOpen?.(); } });
  }
  return <Dropdown trigger={['click']} disabled={!running} open={running && open} onOpenChange={setOpen}
    overlayStyle={{ maxWidth: 400, overflowWrap: 'anywhere' }} menu={{ items }}>
    <button type="button" className={styles.address} disabled={!running} aria-haspopup="menu">
      <code>{address}</code>{running && <ChevronDown size={12} aria-hidden="true" />}
    </button>
  </Dropdown>;
}
