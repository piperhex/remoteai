import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Toast } from '../components/AppToast';
import { TotpCodeCard } from './TotpCodeCard';
import { TotpFormSheet } from './TotpFormSheet';
import { TotpPageHeader, TotpSearchBar } from './TotpPageHeader';
import { TotpAddMenu } from './TotpAddMenu';
import { TotpOptionsMenu } from './TotpOptionsMenu';
import { selectTotpEntries, type TotpSortOrder } from './entryList';
import { usePageStyles as useStyles } from './pageStyles';
import { useTotpStyles } from './styles';
import { generateTotp } from './totp';
import type { TotpEntry, TotpManagerState } from './types';

function useTotpCodes(entries: TotpEntry[]) {
  const [now, setNow] = useState(Date.now());
  const codes = useMemo(() => Object.fromEntries(
    entries.map((entry) => [entry.id, generateTotp(entry, now)]),
  ), [entries, now]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  return { codes, now };
}

function EntryList({ manager, entries, codes, now, onEdit }: {
  manager: TotpManagerState;
  entries: TotpEntry[];
  codes: Record<string, string>;
  now: number;
  onEdit: (entry: TotpEntry) => void;
}) {
  const color = useThemeColor();
  const totpStyles = useTotpStyles();
  useLanguage();
  const confirmDelete = (entry: TotpEntry) => {
    Alert.alert(t("client.mobile.delete2faKey"), t("client.app.deleteTheKeyFor", { value1: entry.issuer }), [
      { text: t("client.accounts.cancel"), style: 'cancel' },
      { text: t("client.projectBrowser.deleted"), style: 'destructive', onPress: () => manager.deleteEntry(entry.id) },
    ]);
  };

  if (!manager.initialized) return <ActivityIndicator color={color("#18af8c", 'accent')} />;
  if (!manager.entries.length) return <View style={totpStyles.empty}>
    <Text style={totpStyles.emptyIcon}>2FA</Text>
    <Text style={totpStyles.emptyTitle}>{t("client.app.no2faKeysYet")}</Text>
    <Text style={totpStyles.emptyText}>{t("client.app.scanAQrCodeOrEnterAKeyToGenerate")}</Text>
  </View>;
  if (!entries.length) return <View style={totpStyles.empty}>
    <Text style={totpStyles.emptyTitle}>{t("client.app.noMatchingAccounts")}</Text>
    <Text style={totpStyles.emptyText}>{t("client.app.tryAnotherServiceOrAccountOrClearTheSearchTo")}</Text>
  </View>;
  return <>{entries.map((entry) => <TotpCodeCard
    key={entry.id}
    entry={entry}
    code={codes[entry.id] ?? ''}
    now={now}
    onCopied={() => Toast.success(t("client.mobile.codeCopied"))}
    onDelete={() => confirmDelete(entry)}
    onEdit={() => onEdit(entry)}
  />)}</>;
}

export function TotpPage({ manager, onBack }: { manager: TotpManagerState; onBack: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scanOnOpen, setScanOnOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TotpSortOrder>('default');
  const [sortOpen, setSortOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const entries = useMemo(() => selectTotpEntries(manager.entries, query, sort), [manager.entries, query, sort]);
  const { codes, now } = useTotpCodes(manager.entries);

  const openForm = (entry: TotpEntry | null, scanFirst = false) => {
    setEditing(entry);
    setScanOnOpen(scanFirst);
    setFormOpen(true);
  };

  const refreshCloud = async () => {
    if (!manager.initialized || manager.syncing) return;
    try {
      const result = await manager.refreshCloud();
      if (result === 'updated') Toast.success(t("client.app.cloud2faKeysRetrieved"));
      if (result === 'current') Toast.success(t("client.mobile.local2faKeysAreUpToDate"));
      if (result === 'empty') Toast.fail(t("client.app.no2faKeysInTheCloud"));
    } catch {
      Toast.fail(t("client.mobile.couldNotFetchCloud2faKeys"));
    }
  };

  return <View style={styles.page}>
    <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <TotpPageHeader onBack={onBack} onAdd={() => setAddOpen(true)} expanded={addOpen} />
    </View>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={manager.syncing}
        onRefresh={() => void refreshCloud()} tintColor={color("#2ba47d", 'accent')} colors={['#2ba47d']} />}>
      <TotpSearchBar query={query} onQueryChange={setQuery} onSort={() => setSortOpen(true)}
        sorted={sort !== 'default'} />
      <EntryList manager={manager} entries={entries} codes={codes} now={now} onEdit={openForm} />
    </ScrollView>
    <TotpOptionsMenu title={t("client.app.sortCodes")} visible={sortOpen} onClose={() => setSortOpen(false)} options={[
      { label: t("client.app.defaultOrder"), icon: 'list-outline', selected: sort === 'default', onPress: () => setSort('default') },
      { label: t("client.app.byServiceName"), icon: 'text-outline', selected: sort === 'name', onPress: () => setSort('name') },
      { label: t("client.app.recentlyAddedFirst"), icon: 'time-outline', selected: sort === 'newest', onPress: () => setSort('newest') },
    ]} />
    <TotpFormSheet
      visible={formOpen}
      entry={editing}
      startWithScanner={scanOnOpen}
      onCancel={() => setFormOpen(false)}
      onSave={(draft) => {
        if (editing) manager.updateEntry(editing.id, draft);
        else manager.addEntry(draft);
      }}
    />
    {addOpen && <TotpAddMenu headerHeight={headerHeight} onClose={() => setAddOpen(false)}
      onManualAdd={() => openForm(null)} onScanAdd={() => openForm(null, true)} />}
  </View>;
}
