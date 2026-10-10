import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SheetInset, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import { palette, useStyles } from './styles';

export interface ChatConnectionProps {
  client: GuiAccountsClient; deviceName?: string; chooseDevice: () => void;
}

type Props = ChatConnectionProps & { ready: boolean; active: boolean } & (
  { variant: 'settings' } | { variant?: 'avatar'; email: string; openTokenSummary: () => void;
    guiTools: GuiToolsClient; running: boolean }
);

const ACCOUNT_REFRESH_INTERVAL_MS = 60_000;

export function ChatProfileMenu(props: Props) {
  const pickerStyles = usePickerStyles();
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const { client, deviceName, ready, active, chooseDevice } = props;
  const settings = props.variant === 'settings';
  const [panel, setPanel] = useState<'profile' | 'accounts' | 'update' | null>(null);
  const [query, setQuery] = useState('');
  const accounts = useGuiAccounts(client, active && ready, panel === 'accounts' ? ACCOUNT_REFRESH_INTERVAL_MS : 0);
  const selection = accounts.snapshot?.selection;
  const current = accounts.snapshot?.choices.find((choice) =>
    selection?.kind === choice.kind && selection.id === choice.id);
  const name = current?.name || t("选择账户");
  const initials = Array.from(current?.name.trim() || '').slice(0, 2).join('') || t("我");
  const disabled = accounts.loading || Boolean(accounts.saving) || !ready || !accounts.snapshot?.running;
  const search = query.trim().toLowerCase();
  const choices = accounts.snapshot?.choices.filter((choice) =>
    `${choice.name} ${choice.detail} ${choice.searchDetail ?? ''}`.toLowerCase().includes(search)) ?? [];
  useEffect(() => { if (!active) setPanel(null); }, [active]);

  const select = async (choice: GuiAccountChoice) => {
    if (disabled || !choice.available || choice === current) return;
    if (await accounts.select({ kind: choice.kind, id: choice.id })) setPanel(settings ? null : 'profile');
  };

  const connectionOptions = <>
    <Pressable accessibilityRole="button" accessibilityLabel={t("切换电脑")}
      style={[pickerStyles.option, settings && pickerStyles.settingOption]}
      onPress={() => { setPanel(null); chooseDevice(); }}>
      <Feather name="monitor" size={22} color={color(palette.ink, 'ink')} />
      <View style={pickerStyles.copy}><Text style={styles.title}>{t("切换电脑")}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{deviceName || t("选择电脑")}</Text></View>
      <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("切换账户")}
      style={[pickerStyles.option, settings && pickerStyles.settingOption]}
      onPress={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }}>
      <Feather name="user" size={22} color={color(palette.ink, 'ink')} />
      <View style={pickerStyles.copy}><Text style={styles.title}>{t("切换账户")}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{name}</Text></View>
      <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
    </Pressable>
  </>;
  return <>
    {settings ? connectionOptions : <Pressable accessibilityRole="button" accessibilityLabel={t("打开头像菜单")}
      accessibilityState={{ expanded: panel !== null && active }} style={pickerStyles.trigger}
      onPress={() => setPanel('profile')}>
      <Text style={pickerStyles.initials}>{initials}</Text>
    </Pressable>}
    {panel === 'update' && active && props.variant !== 'settings' && <ChatGuiUpdateSheet
      client={props.guiTools} active={active} connected={ready} running={props.running} deviceName={deviceName}
      onClose={() => setPanel(null)} onBack={() => setPanel('profile')} />}
    <BottomSheet fullWidthContent visible={panel !== null && panel !== 'update' && active}
      title={panel === 'accounts' ? t("切换账户") : t("账户与电脑")}
      subtitle={panel === 'accounts' ? t("与电脑共用当前聊天账户") : undefined}
      onClose={() => setPanel(null)} dismissible={!accounts.saving} dragFromHeaderOnly
      onBack={panel === 'accounts' && !accounts.saving ? () => setPanel(settings ? null : 'profile') : undefined}>
      {panel === 'profile' && props.variant !== 'settings'
        ? <SheetInset style={[pickerStyles.panel, pickerStyles.readable]}>
        <Text style={pickerStyles.email}>{props.email}</Text>
        {connectionOptions}
        <Pressable accessibilityRole="button" accessibilityLabel={t("更新 Codex GUI")} style={pickerStyles.option}
          onPress={() => setPanel('update')}>
          <Feather name="download" size={22} color={color(palette.ink, 'ink')} />
          <View style={pickerStyles.copy}><Text style={styles.title}>{t("更新 Codex GUI")}</Text>
            <Text style={styles.subtitle}>{t("检查并更新当前电脑上的 Codex GUI")}</Text></View>
          <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Token 汇总")} style={pickerStyles.option}
          onPress={() => { setPanel(null); props.openTokenSummary(); }}>
          <Feather name="bar-chart-2" size={22} color={color(palette.ink, 'ink')} />
          <View style={pickerStyles.copy}><Text style={styles.title}>{t("Token 汇总")}</Text>
            <Text style={styles.subtitle}>{t("查看用量趋势与消耗排行")}</Text></View>
          <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
        </Pressable>
      </SheetInset> : <View style={pickerStyles.panel}>
        <SheetInset style={[pickerStyles.fields, pickerStyles.readable]}>
          <TextInput accessibilityLabel={t("搜索账户")} placeholder={t("搜索名称或备注")} value={query} onChangeText={setQuery}
            autoCapitalize="none" autoCorrect={false} style={styles.search} />
          {!ready && <Text style={styles.subtitle}>{t("连接电脑后即可切换账户。")}</Text>}
          {accounts.loading && <ActivityIndicator color={color(palette.green, 'accent')} accessibilityLabel={t("正在同步账户")} />}
          {ready && accounts.snapshot && !accounts.snapshot.running &&
            <Text style={styles.subtitle}>{t("请先在电脑上开启本地代理，再切换账户。")}</Text>}
          {!!accounts.error && <View style={styles.row}>
            <Text accessibilityRole="alert" style={[styles.error, styles.fill]}>{accounts.error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("重试读取账户")}
              disabled={!ready || accounts.loading || Boolean(accounts.saving)} onPress={accounts.refresh}>
              <Text style={styles.buttonText}>{t("重试")}</Text>
            </Pressable>
          </View>}
        </SheetInset>
        <SheetScrollView style={pickerStyles.list} contentContainerStyle={pickerStyles.readable}
          keyboardShouldPersistTaps="handled">
          {choices.map((choice) => {
            const selected = choice === current;
            return <Pressable key={`${choice.kind}:${choice.id}`} accessibilityRole="button"
              accessibilityLabel={choice.name} accessibilityState={{
                selected, disabled: disabled || selected || !choice.available,
              }} disabled={disabled || selected || !choice.available} onPress={() => { void select(choice); }}
              style={[pickerStyles.option, selected && pickerStyles.selected,
                (disabled || !choice.available) && styles.disabled]}>
              <View style={pickerStyles.copy}>
                <Text numberOfLines={1} style={styles.title}>{choice.name}</Text>
                <Text style={styles.subtitle}>{choice.detail}</Text>
                {!choice.available && <Text style={styles.subtitle}>{t("此账户暂不可用")}</Text>}
              </View>
              {accounts.saving === `${choice.kind}:${choice.id}`
                ? <ActivityIndicator color={color(palette.green, 'accent')} accessibilityLabel={t("正在切换")} />
                : selected && <Text style={styles.buttonText}>{t("当前")}</Text>}
            </Pressable>;
          })}
          {!choices.length && accounts.snapshot && !accounts.loading && <Text style={pickerStyles.empty}>
            {accounts.snapshot.choices.length ? t("没有找到匹配的账户。") : t("暂无可选账户，请先在电脑上添加账户。")}</Text>}
        </SheetScrollView>
      </View>}
    </BottomSheet>
  </>;
}

const usePickerStyles = createThemedStyles((color) => ({
  trigger: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#304e63',
    justifyContent: 'center', alignItems: 'center', borderWidth: 5, borderColor: color(palette.background, 'canvas') },
  initials: { color: '#fff', fontSize: 15, fontWeight: '500' },
  email: { color: color(palette.muted, 'muted'), fontSize: 14, lineHeight: 21 },
  panel: { flexShrink: 1, gap: 12, paddingBottom: 16 },
  fields: { gap: 12 },
  readable: { width: '100%', maxWidth: SHEET_READABLE_WIDTH, alignSelf: 'center' },
  list: { maxHeight: 360 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: 12 },
  settingOption: { borderWidth: 1, borderColor: color(palette.border, 'border') },
  selected: { backgroundColor: color(palette.pale, 'accentSoft') },
  copy: { flex: 1, minWidth: 0 },
  empty: { color: color(palette.muted, 'muted'), fontSize: 13, lineHeight: 20, paddingVertical: 16 },
}));
