import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AccountSummary } from '../types';
import { BottomSheet } from './BottomSheet';
import { SheetScrollView, SheetInset } from './SheetScrollView';

interface QuotaConsumptionSheetProps {
  visible: boolean;
  accounts: AccountSummary[];
  concealEmails: boolean;
  consuming: boolean;
  onClose: () => void;
  onConfirm: (accountIds: string[]) => Promise<void>;
}

function maskEmail(email: string) {
  const at = email.indexOf('@');
  if (at < 2) return '******';
  const local = email.slice(0, at);
  const hidden = '*'.repeat(Math.min(5, Math.max(2, local.length - 2)));
  return `${local.slice(0, 2)}${hidden}${email.slice(at)}`;
}

function remainingLabel(account: AccountSummary) {
  const remaining = account.usage.primary?.remainingPercent;
  return typeof remaining === 'number' ? t("主额度剩余 {value1}%", { value1: Math.round(remaining) }) : t("主额度暂不可用");
}

function resetLabel(account: AccountSummary, now: number) {
  const timestamp = account.usage.primary?.resetsAt;
  if (!timestamp) return t("主额度重置时间暂不可用");
  const resetAt = new Date(timestamp * 1000);
  if (Number.isNaN(resetAt.getTime())) return t("主额度重置时间暂不可用");
  const milliseconds = resetAt.getTime() - now;
  if (milliseconds <= 0) return t("主额度即将重置");
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return t("主额度约 {value1}{value2} 小时 {value3} 分后重置", { value1: days ? `${days} 天 ` : '', value2: hours, value3: minutes });
}

export function QuotaConsumptionSheet({
  visible,
  accounts,
  concealEmails,
  consuming,
  onClose,
  onConfirm,
}: QuotaConsumptionSheetProps) {
  const styles = useStyles();
  useLanguage();
  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const accountIdsKey = accountIds.join('\n');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busy = consuming || submitting;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = accountIds.filter((id) => selectedIdSet.has(id)).length;
  const allSelected = accounts.length > 0 && selectedCount === accounts.length;

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(accountIds);
  }, [accountIdsKey, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [visible]);

  const toggleAccount = (accountId: string) => {
    if (busy) return;
    setSelectedIds((current) => current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId]);
  };

  const confirm = async () => {
    const validIds = accountIds.filter((id) => selectedIdSet.has(id));
    if (!validIds.length || busy) return;
    setSubmitting(true);
    try {
      await onConfirm(validIds);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return <BottomSheet fullWidthContent
    visible={visible}
    tall
    title={t("选择消耗额度的账号")}
    subtitle={t("已选择 {value1} / {value2} 个账号", { value1: selectedCount, value2: accounts.length })}
    onClose={onClose}
    dismissible={!busy}
    actions={[
      { label: t("取消"), onPress: onClose, disabled: busy },
      {
        label: selectedCount ? t("消耗所选 {value1} 个账号", { value1: selectedCount }) : t("请先选择账号"),
        tone: 'danger',
        onPress: confirm,
        loading: busy,
        disabled: selectedCount === 0,
      },
    ]}
  >
    <SheetInset>
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>{t("此操作会产生真实用量")}</Text>
        <Text style={styles.warningText}>{t("手机将直接向所选账号发送“今天天气如何？”，完成后自动刷新用量。")}</Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allSelected, disabled: busy }}
        disabled={busy}
        onPress={() => setSelectedIds(allSelected ? [] : accountIds)}
        style={({ pressed }) => [styles.selectAllRow, pressed && styles.pressed]}
      >
        <Text style={styles.selectAllText}>{allSelected ? t("取消全选") : t("全选可用账号")}</Text>
        <View style={[styles.checkbox, allSelected && styles.checkboxChecked]}>
          <Text style={styles.checkboxText}>{allSelected ? '✓' : ''}</Text>
        </View>
      </Pressable>
    </SheetInset>
    <SheetScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {accounts.map((account) => {
        const selected = selectedIdSet.has(account.id);
        return <Pressable
          key={account.id}
          accessibilityRole="checkbox"
          accessibilityLabel={account.email}
          accessibilityState={{ checked: selected, disabled: busy }}
          disabled={busy}
          onPress={() => toggleAccount(account.id)}
          style={({ pressed }) => [
            styles.accountRow,
            selected && styles.accountRowSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.accountIdentity}>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {concealEmails ? maskEmail(account.email) : account.email}
            </Text>
            <Text style={styles.accountMeta} numberOfLines={1}>
              {account.plan || 'ChatGPT'} · {remainingLabel(account)}
            </Text>
            <Text style={styles.accountReset} numberOfLines={1}>
              {resetLabel(account, now)}
            </Text>
          </View>
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
          </View>
        </Pressable>;
      })}
    </SheetScrollView>
  </BottomSheet>;
}

const useStyles = createThemedStyles((color) => ({
  warning: { borderRadius: 14, backgroundColor: color('#fff5e8', 'accentSoft'), padding: 14, marginBottom: 12 },
  warningTitle: { color: color('#8a4e16', 'warning'), fontSize: 13, fontWeight: '900' },
  warningText: { color: color('#8a633c', 'warning'), fontSize: 12, lineHeight: 18, marginTop: 4 },
  selectAllRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color('#e4ece7', 'border'),
    paddingHorizontal: 4,
  },
  selectAllText: { color: color('#14806f', 'accent'), fontSize: 13, fontWeight: '900' },
  list: { maxHeight: 430 },
  listContent: { paddingTop: 8, paddingBottom: 4, gap: 8 },
  accountRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: color('#dce8df', 'border'),
    borderRadius: 14,
    backgroundColor: color('#ffffff', 'surface'),
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  accountRowSelected: { borderColor: color('#76cbb4', 'border'), backgroundColor: color('#f0faf6', 'canvas') },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountEmail: { color: color('#13231c', 'ink'), fontSize: 14, fontWeight: '800' },
  accountMeta: { color: color('#6f8177', 'muted'), fontSize: 11, marginTop: 5 },
  accountReset: { color: color('#708078', 'muted'), fontSize: 11, marginTop: 3 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: color('#aebeb5', 'border'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { borderColor: color('#18af8c', 'accent'), backgroundColor: '#18af8c' },
  checkboxText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.78 },
}));
