import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { Dropdown, type MenuProps } from 'antd';
import { ChevronDown } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { DetailsContext } from '../../../../../../shared/conversation/detailsContext';
import { BrowserNavigationContext } from '../../../../../../shared/browser/BrowserNavigationProvider';
import { openWebsiteInBrowser } from '../../../../../../shared/conversation/WebsiteLinkMenu';
import { localMappingAddress, localMappingUrl, mappingAddress } from '../../../../../../shared/port-mapping/target';
import { browserMappings } from '../../../../../../shared/port-mapping/browserMappings';
import type { ForwardingEntry } from './service';
import styles from './portForwarding.module.less';

export function ForwardedAddress({ entry, onOpen, local }: {
  entry: ForwardingEntry; onOpen?: () => void; local?: boolean;
}) {
  const panel = useContext(DetailsContext);
  const browser = useContext(BrowserNavigationContext);
  const preview = panel ?? browser;
  const [open, setOpen] = useState(false);
  const address = localMappingAddress(entry);
  const mappedUrl = localMappingUrl(entry);
  const ready = useSyncExternalStore(browserMappings.subscribe, () => !!local && !!entry.localDomain
    && browserMappings.snapshot().some(item => item.url === mappedUrl + '/' && item.target === mappingAddress(entry)));
  const available = local ? !entry.localDomain || (ready && !!preview) : entry.status === 'running';
  useEffect(() => { if (!available) setOpen(false); }, [available]);
  // The host already reaches the configured target directly. Only the viewer listens on the mapped port.
  const url = local && !entry.localDomain
    ? `${entry.linkProtocol ?? 'http'}://${mappingAddress(entry)}`
    : mappedUrl;
  const items: MenuProps['items'] = [
    { key: 'preview', label: t("client.portForwarding.previewInRemoteAi"), disabled: !preview,
      onClick: () => { preview?.openWebsite(url, { resolved: true }); onOpen?.(); } },
  ];
  if (!entry.localDomain) {
    items.push({ key: 'browser', label: t("client.workspaceActions.openInBrowser"),
      onClick: () => { void openWebsiteInBrowser(url); onOpen?.(); } });
  }
  return <Dropdown trigger={['click']} disabled={!available} open={available && open} onOpenChange={setOpen}
    overlayStyle={{ maxWidth: 400, overflowWrap: 'anywhere' }} menu={{ items }}>
    <button type="button" className={styles.address} disabled={!available} aria-haspopup="menu"
      aria-expanded={available && open}>
      <code>{address}</code>{available && <ChevronDown size={12} aria-hidden="true" />}
    </button>
  </Dropdown>;
}
