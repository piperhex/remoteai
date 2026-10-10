import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useState } from 'react';
import { remoteModelOptions, type RemoteModelTarget } from '../../../../shared/remote-chat/modelTarget';
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from '../types';
import { BottomSheet } from './BottomSheet';
import { SheetScrollView } from './SheetScrollView';

interface ModelOptionProps {
  badge: string;
  title: string;
  subtitle: string;
  current: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}

function ModelOption({
  badge,
  title,
  subtitle,
  current,
  disabled,
  loading,
  onPress,
}: ModelOptionProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled, selected: current }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.option,
      current && styles.optionCurrent,
      pressed && styles.optionPressed,
      disabled && !current && styles.optionDisabled,
    ]}
  >
    <View style={[styles.badge, current && styles.badgeCurrent]}>
      <Text style={[styles.badgeText, current && styles.badgeTextCurrent]}>{badge}</Text>
    </View>
    <View style={styles.optionCopy}>
      <Text style={styles.optionTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.optionSubtitle} numberOfLines={1}>{subtitle}</Text>
    </View>
    {loading
      ? <ActivityIndicator color={color("#14806f", 'accent')} size="small" />
      : current
        ? <View style={styles.currentPill}><Text style={styles.currentText}>{t("当前")}</Text></View>
        : <Text style={styles.chevron}>›</Text>}
  </Pressable>;
}

interface RemoteModelSwitchSheetProps {
  device: RemoteDevice | null;
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  switchingAccountId: string | null;
  switchingProviderId: string | null;
  onClose: () => void;
  onSwitchAccount: (deviceId: string, accountId: string, target: RemoteModelTarget) => Promise<boolean>;
  onSwitchProvider: (deviceId: string, providerId: string, target: RemoteModelTarget) => Promise<boolean>;
  onSwitchProviderGroup: (deviceId: string, group: string) => Promise<boolean>;
}

export function RemoteModelSwitchSheet({
  device,
  accounts,
  providers,
  switchingAccountId,
  switchingProviderId,
  onClose,
  onSwitchAccount,
  onSwitchProvider,
  onSwitchProviderGroup,
}: RemoteModelSwitchSheetProps) {
  const styles = useStyles();
  useLanguage();
  const [target, setTarget] = useState<RemoteModelTarget>('proxy');
  const busy = Boolean(switchingAccountId || switchingProviderId);
  const options = remoteModelOptions(device, target);
  const { supported: providerSupported, providerAvailable, groupSupported } = options;
  const groups = target === 'gui' ? [] : [...new Set(providers.map((provider) => provider.group).filter(Boolean))];

  const selectAccount = async (accountId: string) => {
    if (!device?.online || busy || !options.accountAvailable) return;
    if (await onSwitchAccount(device.deviceId, accountId, target)) onClose();
  };
  const selectProvider = async (providerId: string) => {
    if (!device?.online || busy || !providerAvailable) return;
    if (await onSwitchProvider(device.deviceId, providerId, target)) onClose();
  };
  const selectProviderGroup = async (group: string) => {
    if (!device?.online || busy || !providerAvailable || !groupSupported) return;
    if (await onSwitchProviderGroup(device.deviceId, group)) onClose();
  };

  return <BottomSheet fullWidthContent
    visible={Boolean(device)}
    title={t("切换模型")}
    subtitle={device ? t("{value1} · 选择这台 PC 使用的模型来源", { value1: device.name }) : undefined}
    onClose={onClose}
    dismissible={!busy}
    tall
  >
    <SheetScrollView style={styles.scroll}>
      <View style={styles.targetRow} accessibilityRole="tablist">
        {(['proxy', 'gui'] as const).map((value) => <Pressable key={value}
          accessibilityRole="tab" accessibilityState={{ selected: target === value, disabled: busy }}
          disabled={busy} onPress={() => setTarget(value)}
          style={[styles.targetButton, target === value && styles.targetSelected]}>
          <Text style={[styles.targetText, target === value && styles.targetTextSelected]}>
            {value === 'gui' ? t("Codex GUI 模型") : t("代理接口模型")}
          </Text>
        </Pressable>)}
      </View>
      <Text style={styles.description}>{target === 'gui'
        ? t("仅切换 Codex GUI 使用的模型来源。") : t("仅切换代理接口使用的模型来源。")}</Text>
      {target === 'gui' && !providerSupported
        ? <Text style={styles.emptyText}>{t("请先更新 PC 端，再切换 Codex GUI 模型。")}</Text> : null}
      <Text style={styles.sectionTitle}>{t("官方模型")}</Text>
      {!accounts.length ? <Text style={styles.emptyText}>{t("暂无已同步的官方账号。")}</Text> : accounts.map((account) => {
        const current = !options.providerId && !options.group && options.accountId === account.id;
        return <ModelOption
          key={`account:${account.id}`}
          badge="O"
          title={account.email}
          subtitle={t("官方模型 · {value1}", { value1: account.plan || 'ChatGPT' })}
          current={current}
          disabled={busy || !device?.online || !options.accountAvailable || current}
          loading={switchingAccountId === account.id}
          onPress={() => void selectAccount(account.id)}
        />;
      })}

      <View style={styles.providerHeading}>
        <Text style={styles.sectionTitle}>{t("第三方 Provider")}</Text>
        {!providerSupported
          ? <Text style={styles.hint}>{t("请先更新 PC 端")}</Text>
          : !providerAvailable
            ? <Text style={styles.hint}>{t("请先在 PC 端启动本地代理")}</Text>
            : null}
      </View>
      {!providers.length ? <Text style={styles.emptyText}>{t("暂无已同步的第三方 Provider。")}</Text> : <>
        {groups.map((group) => {
          const count = providers.filter((provider) => provider.group === group).length;
          const current = device?.activeProviderGroup === group;
          return <ModelOption key={`group:${group}`} badge="G" title={group}
            subtitle={t("同时启用 {value1} 个 API", { value1: count })} current={current}
            disabled={busy || !device?.online || !providerAvailable || !groupSupported || current}
            loading={switchingProviderId === `group:${group}`}
            onPress={() => void selectProviderGroup(group)} />;
        })}
        {providers.map((provider) => {
          const current = options.providerId === provider.id;
          return <ModelOption
            key={`provider:${provider.id}`}
            badge="P"
            title={provider.name}
            subtitle={provider.model || t("由 Codex 选择模型")}
            current={current}
            disabled={busy || !device?.online || !providerAvailable || current}
            loading={switchingProviderId === provider.id}
            onPress={() => void selectProvider(provider.id)}
          />;
        })}
      </>}
      <Text style={styles.footerHint}>
        {target === 'gui' ? t("切换后，Codex GUI 的后续请求将使用所选来源，无需重启。")
          : t("在官方模型与第三方 Provider 之间切换后，需要重启 ChatGPT/Codex 才能加载当前模型。")}
      </Text>
    </SheetScrollView>
  </BottomSheet>;
}

const useStyles = createThemedStyles((color) => ({
  targetRow: { flexDirection: 'row', backgroundColor: color('#eaf2ed', 'elevated'), borderRadius: 12, padding: 4, gap: 4 },
  targetButton: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10, borderRadius: 9 },
  targetSelected: { backgroundColor: color('#fff', 'surface') },
  targetText: { fontSize: 12, fontWeight: '700', color: color('#7c8c83', 'muted'), textAlign: 'center' },
  targetTextSelected: { color: color('#0b6e59', 'accent') },
  description: { color: color('#7c8c83', 'muted'), fontSize: 11, lineHeight: 17, marginVertical: 12, maxWidth: 400 },
  scroll: { maxHeight: 610 },
  sectionTitle: { color: color('#52675c', 'ink'), fontSize: 12, fontWeight: '800', marginBottom: 9 },
  providerHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  hint: { color: color('#b06b28', 'warning'), fontSize: 10, marginBottom: 9, maxWidth: 190, textAlign: 'right' },
  emptyText: { color: color('#7c8c83', 'muted'), fontSize: 12, lineHeight: 18, paddingVertical: 12 },
  option: {
    alignItems: 'center',
    backgroundColor: color('#fff', 'surface'),
    borderColor: color('#dce9e2', 'border'),
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    marginBottom: 9,
    minHeight: 66,
    padding: 12,
  },
  optionCurrent: { backgroundColor: color('#f0faf6', 'canvas'), borderColor: color('#9bd5c2', 'border') },
  optionPressed: { opacity: 0.82 },
  optionDisabled: { opacity: 0.52 },
  badge: {
    alignItems: 'center',
    backgroundColor: color('#e7f5ef', 'canvas'),
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  badgeCurrent: { backgroundColor: color('#ccecdf', 'accentSoft') },
  badgeText: { color: color('#14806f', 'accent'), fontSize: 14, fontWeight: '900' },
  badgeTextCurrent: { color: color('#0b6e59', 'accent') },
  optionCopy: { flex: 1, minWidth: 0 },
  optionTitle: { color: color('#17352a', 'ink'), fontSize: 13, fontWeight: '800' },
  optionSubtitle: { color: color('#7c8c83', 'muted'), fontSize: 10, marginTop: 5 },
  currentPill: { backgroundColor: color('#dff4eb', 'canvas'), borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  currentText: { color: color('#0c765f', 'accent'), fontSize: 10, fontWeight: '800' },
  chevron: { color: color('#91a198', 'muted'), fontSize: 24, lineHeight: 25 },
  footerHint: { color: color('#7c8c83', 'muted'), fontSize: 11, lineHeight: 17, marginTop: 13, maxWidth: 400, alignSelf: 'center' },
}));
