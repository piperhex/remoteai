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
    Alert.alert(t("删除 2FA 密钥"), t("确定删除“{value1}”的密钥吗？", { value1: entry.issuer }), [
      { text: t("取消"), style: 'cancel' },
      { text: t("删除"), style: 'destructive', onPress: () => manager.deleteEntry(entry.id) },
    ]);
  };

  if (!manager.initialized) return <ActivityIndicator color={color("#18af8c", 'accent')} />;
  if (!manager.entries.length) return <View style={totpStyles.empty}>
    <Text style={totpStyles.emptyIcon}>2FA</Text>
    <Text style={totpStyles.emptyTitle}>{t("还没有 2FA 密钥")}</Text>
    <Text style={totpStyles.emptyText}>{t("扫描二维码或手动输入密钥，即可生成动态验证码。")}</Text>
  </View>;
  if (!entries.length) return <View style={totpStyles.empty}>
    <Text style={totpStyles.emptyTitle}>{t("没有找到匹配的账号")}</Text>
    <Text style={totpStyles.emptyText}>{t("试试其他服务名称或账号，或清空搜索查看全部。")}</Text>
  </View>;
  return <>{entries.map((entry) => <TotpCodeCard
    key={entry.id}
    entry={entry}
    code={codes[entry.id] ?? ''}
    now={now}
    onCopied={() => Toast.success(t("验证码已复制"))}
    onDelete={() => confirmDelete(entry)}
    onEdit={() => onEdit(entry)}
  />)}</>;
}

export function TotpPage({ manager }: { manager: TotpManagerState }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scanOnOpen, setScanOnOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TotpSortOrder>('default');
  const [sortOpen, setSortOpen] = useState(false);
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
      if (result === 'updated') Toast.success(t("已获取云端 2FA 密钥"));
      if (result === 'current') Toast.success(t("本机 2FA 已是最新"));
      if (result === 'empty') Toast.fail(t("云端暂无 2FA 密钥"));
    } catch {
      Toast.fail(t("获取云端 2FA 密钥失败"));
    }
  };

  return <View style={styles.page}>
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={manager.syncing}
        onRefresh={() => void refreshCloud()} tintColor={color("#2ba47d", 'accent')} colors={['#2ba47d']} />}>
      <TotpPageHeader onManualAdd={() => openForm(null)} onScanAdd={() => openForm(null, true)} />
      <TotpSearchBar query={query} onQueryChange={setQuery} onSort={() => setSortOpen(true)}
        sorted={sort !== 'default'} />
      <EntryList manager={manager} entries={entries} codes={codes} now={now} onEdit={openForm} />
    </ScrollView>
    <TotpOptionsMenu title={t("验证码排序")} visible={sortOpen} onClose={() => setSortOpen(false)} options={[
      { label: t("默认顺序"), icon: 'list-outline', selected: sort === 'default', onPress: () => setSort('default') },
      { label: t("按服务名称"), icon: 'text-outline', selected: sort === 'name', onPress: () => setSort('name') },
      { label: t("最近添加优先"), icon: 'time-outline', selected: sort === 'newest', onPress: () => setSort('newest') },
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
  </View>;
}
