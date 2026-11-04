import { t, useLanguage } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { Button, Dialog, Empty, Input, PullToRefresh, SpinLoading, Toast } from 'antd-mobile';
import { ListFilter, Plus, QrCode, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { TotpEntry } from '../types';
import type { useTotpVault } from '../useTotpVault';
import { selectTotpEntries, type TotpSortOrder } from '../../../../shared/totp/entryList';
import { TotpCodeCard } from '../totp/TotpCodeCard';
import { TotpForm } from '../totp/TotpForm';
import { useTotpCodes } from '../totp/useTotpCodes';
import { TotpMobileHeader } from '../totp/TotpMobileHeader';
import { DiscoveryBackButton } from '../discovery/DiscoveryPage';
import '../totp/styles.css';

const SORT_OPTIONS = [{ key: 'default', get label() { return t("client.app.defaultOrder"); } }, { key: 'name', get label() { return t("client.app.byServiceName"); } },
  { key: 'newest', get label() { return t("client.app.recentlyAddedFirst"); } }];
const REFRESH_TEXT = { get pulling() { return t("client.app.pullToSync"); }, get canRelease() { return t("client.app.releaseToSync"); }, get refreshing() { return t("client.app.syncing"); }, get complete() { return t("client.app.synced"); } };

export function TotpPage({ manager, onBack }: {
  manager: ReturnType<typeof useTotpVault>; onBack: () => void;
}) {
  useLanguage();
  const [form, setForm] = useState<{ entry: TotpEntry | null; scanFirst: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TotpSortOrder>('default');
  const refreshing = useRef(false);
  const entries = useMemo(() => selectTotpEntries(manager.entries, query, sort), [manager.entries, query, sort]);
  const { codes, now } = useTotpCodes(manager.entries);
  const refresh = async () => {
    if (refreshing.current || manager.syncing || !manager.initialized) return;
    refreshing.current = true;
    try {
      const result = await manager.refreshCloud();
      const messages = { empty: t("client.app.no2faKeysInTheCloud"), current: t("client.app.2faKeysAreUpToDate"), updated: t("client.app.cloud2faKeysRetrieved") };
      Toast.show({ content: messages[result] });
    } catch { Toast.show({ icon: 'fail', content: t("client.app.couldNotRetrieveCloud2faKeysPleaseTryAgain") }); }
    finally { refreshing.current = false; }
  };
  const remove = async (entry: TotpEntry) => {
    const confirmed = await Dialog.confirm({ title: t("client.app.delete2faKey"),
      content: t("client.app.deleteTheKeyFor", { value1: entry.issuer }), confirmText: t("client.projectBrowser.deleted"), cancelText: t("client.accounts.cancel") });
    if (confirmed) manager.deleteEntry(entry.id);
  };
  return <>
    <div className="verification-desktop-back"><DiscoveryBackButton onBack={onBack} /></div>
    <TotpMobileHeader onBack={onBack} onManualAdd={() => setForm({ entry: null, scanFirst: false })}
      onScanAdd={() => setForm({ entry: null, scanFirst: true })} />
    <PullToRefresh onRefresh={refresh} renderText={status => REFRESH_TEXT[status]}>
      <div className="page-body verification-page">
        <header className="verification-heading"><div><h1>{t("client.app.2faCodes")}</h1>
          <p>{t("client.app.syncYourKeysAndTapACodeToCopyIt")}</p></div><ShieldCheck size={82} aria-hidden="true" /></header>
        <div className="verification-actions">
          <Button onClick={() => setForm({ entry: null, scanFirst: false })}><Plus size={22} />{t("client.app.addManually")}</Button>
          <Button color="primary" onClick={() => setForm({ entry: null, scanFirst: true })}>
            <QrCode size={22} />{t("client.app.scanQrCode")}</Button>
        </div>
        <div className="verification-toolbar"><label className="verification-search"><Search size={20} />
          <Input value={query} onChange={setQuery} aria-label={t("client.app.searchServicesOrAccounts")} placeholder={t("client.app.searchServicesOrAccounts")} clearable />
        </label><Dropdown trigger={['click']} menu={{ selectable: true, selectedKeys: [sort], items: SORT_OPTIONS,
          onClick: ({ key }) => setSort(key as TotpSortOrder) }}>
          <button className="icon-button" type="button" aria-label={t("client.app.sortCodes")}><ListFilter size={23} /></button>
        </Dropdown><button className="icon-button" type="button" aria-label={t("client.app.sync2faKeys")}
          disabled={manager.syncing || !manager.initialized} onClick={() => void refresh()}>
          <RefreshCw size={20} className={manager.syncing ? 'spin' : ''} /></button></div>
        {!manager.initialized ? <div className="page-loading"><SpinLoading /><span>{t("client.app.loading2faKeys")}</span></div>
          : !entries.length ? <div className="verification-empty"><Empty
            description={manager.entries.length ? t("client.app.noMatchingAccounts") : t("client.app.no2faKeysYet")} />
            <p>{manager.entries.length ? t("client.app.tryAnotherServiceOrAccountOrClearTheSearchTo")
              : t("client.app.scanAQrCodeOrEnterAKeyToGenerate")}</p></div>
            : <div className="verification-grid">{entries.map(entry => <TotpCodeCard key={entry.id} entry={entry}
              code={codes[entry.id] ?? ''} now={now} onEdit={() => setForm({ entry, scanFirst: false })}
              onDelete={() => void remove(entry)} />)}</div>}
      </div>
    </PullToRefresh>
    {form && <TotpForm {...form} onSave={manager.saveEntry} onClose={() => setForm(null)} />}
  </>;
}
