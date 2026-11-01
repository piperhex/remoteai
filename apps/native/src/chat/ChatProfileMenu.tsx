import { displayError } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SheetInset, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import type { GuiAccountChoice, GuiAccountsClient } from '../../../../shared/remote-chat/guiAccounts';
import { guiAccountAvatar } from '../../../../shared/remote-chat/guiAccountAvatar';
import { useGuiAccounts } from '../../../../shared/remote-chat/client/useGuiAccounts';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import { palette, useStyles } from './styles';
import { ChatSettingsConnection } from './ChatSettingsConnection';

export interface ChatConnectionProps {
  client: GuiAccountsClient; deviceName?: string; chooseDevice: () => void;
}

type Props = ChatConnectionProps & { ready: boolean; active: boolean } & (
  { variant: 'settings' } | { variant?: 'avatar'; email: string;
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
  const name = current?.name || t("client.chat.chooseAccount");
  const { initials } = guiAccountAvatar(accounts.snapshot, t("client.chat.me"));
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
    <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.switchComputer")}
      style={pickerStyles.option}
      onPress={() => { setPanel(null); chooseDevice(); }}>
      <Feather name="monitor" size={22} color={color(palette.ink, 'ink')} />
      <View style={pickerStyles.copy}><Text style={styles.title}>{t("client.chat.switchComputer")}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{deviceName || t("client.settings.chooseAComputer")}</Text></View>
      <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.switchAccount")}
      style={pickerStyles.option}
      onPress={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }}>
      <Feather name="user" size={22} color={color(palette.ink, 'ink')} />
      <View style={pickerStyles.copy}><Text style={styles.title}>{t("client.chat.switchAccount")}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{name}</Text></View>
      <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
    </Pressable>
  </>;
  return <>
    {settings ? <ChatSettingsConnection deviceName={deviceName || t('client.settings.chooseAComputer')}
      accountName={name} onDevice={() => { setPanel(null); chooseDevice(); }}
      onAccount={() => { setQuery(''); setPanel('accounts'); if (ready) accounts.refresh(); }} />
      : <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.openProfileMenu")}
      accessibilityState={{ expanded: panel !== null && active }} style={pickerStyles.trigger}
      onPress={() => setPanel('profile')}>
      <Text style={pickerStyles.initials}>{initials}</Text>
    </Pressable>}
    {panel === 'update' && active && props.variant !== 'settings' && <ChatGuiUpdateSheet
      client={props.guiTools} active={active} connected={ready} running={props.running} deviceName={deviceName}
      onClose={() => setPanel(null)} onBack={() => setPanel('profile')} />}
    <BottomSheet fullWidthContent visible={panel !== null && panel !== 'update' && active}
      title={panel === 'accounts' ? t("client.chat.switchAccount") : t("client.chat.accountAndComputer")}
      subtitle={panel === 'accounts' ? t("client.chat.useTheSameChatAccountAsYourComputer") : undefined}
      onClose={() => setPanel(null)} dismissible={!accounts.saving}
      onBack={panel === 'accounts' && !accounts.saving ? () => setPanel(settings ? null : 'profile') : undefined}>
      {panel === 'profile' && props.variant !== 'settings'
        ? <SheetInset style={[pickerStyles.panel, pickerStyles.readable]}>
        <Text style={pickerStyles.email}>{props.email}</Text>
        {connectionOptions}
        <Pressable accessibilityRole="button" accessibilityLabel={t("client.app.updateCodexGui")} style={pickerStyles.option}
          onPress={() => setPanel('update')}>
          <Feather name="download" size={22} color={color(palette.ink, 'ink')} />
          <View style={pickerStyles.copy}><Text style={styles.title}>{t("client.app.updateCodexGui")}</Text>
            <Text style={styles.subtitle}>{t("client.app.checkAndUpdateCodexGuiOnThisComputer")}</Text></View>
          <Feather name="chevron-right" size={18} color={color(palette.muted, 'muted')} />
        </Pressable>
      </SheetInset> : <View style={pickerStyles.panel}>
        <SheetInset style={[pickerStyles.fields, pickerStyles.readable]}>
          <TextInput accessibilityLabel={t("client.chat.searchAccounts")} placeholder={t("client.chat.searchNamesOrNotes")} value={query} onChangeText={setQuery}
            autoCapitalize="none" autoCorrect={false} style={styles.search} />
          {!ready && <Text style={styles.subtitle}>{t("client.chat.connectToYourComputerToSwitchAccounts")}</Text>}
          {accounts.loading && <ActivityIndicator color={color(palette.green, 'accent')} accessibilityLabel={t("client.mobile.syncingAccounts")} />}
          {ready && accounts.snapshot && !accounts.snapshot.running &&
            <Text style={styles.subtitle}>{t("client.chat.chatIsUnavailableOnYourComputerReopenRemoteAiOn")}</Text>}
          {!!accounts.error && <View style={styles.row}>
            <Text accessibilityRole="alert" style={[styles.error, styles.fill]}>{displayError(accounts.error)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.reloadAccounts")}
              disabled={!ready || accounts.loading || Boolean(accounts.saving)} onPress={accounts.refresh}>
              <Text style={styles.buttonText}>{t("client.terminal.retry")}</Text>
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
                {!choice.available && <Text style={styles.subtitle}>{t("client.chat.thisAccountIsUnavailable")}</Text>}
              </View>
              {accounts.saving === `${choice.kind}:${choice.id}`
                ? <ActivityIndicator color={color(palette.green, 'accent')} accessibilityLabel={t("client.mobile.switching")} />
                : selected && <Text style={styles.buttonText}>{t("client.accounts.current")}</Text>}
            </Pressable>;
          })}
          {!choices.length && accounts.snapshot?.running && !accounts.loading && <Text style={pickerStyles.empty}>
            {accounts.snapshot.choices.length ? t("client.chat.noMatchingAccounts") : t("client.chat.noAccountsAvailableAddAnAccountOnYourComputerFirst")}</Text>}
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
  selected: { backgroundColor: color(palette.pale, 'accentSoft') },
  copy: { flex: 1, minWidth: 0 },
  empty: { color: color(palette.muted, 'muted'), fontSize: 13, lineHeight: 20, paddingVertical: 16 },
}));
