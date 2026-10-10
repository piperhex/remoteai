import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DesktopInput, DesktopPlatform } from '../../../../../shared/remote-desktop/protocol';
import { desktopShortcuts, desktopModifiers, INPUT_TABS, KEYBOARD_PAGES }
  from '../../../../../shared/remote-desktop/softKeyboard';
import { useSoftKeyboard } from '../../../../../shared/remote-desktop/useSoftKeyboard';
import { DesktopIme } from './DesktopIme';
import { useKeyboardStyles as useS } from './keyboardStyles';

export function DesktopKeyboard({ input, close, compact, supported, platform }: {
  input: (input: DesktopInput) => void; close: () => void; compact: boolean; supported: boolean;
  platform?: DesktopPlatform;
}) {
  const resolveThemeColor = useThemeColor();
  const s = useS();
  const color = useThemeColor();
  useLanguage();
  const keyboard = useSoftKeyboard(input);
  const dismiss = () => { Keyboard.dismiss(); close(); };
  return <View style={s.root}>
    <View style={s.tabs} accessibilityRole="tablist">
      {INPUT_TABS.map(tab => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={t(tab.label)}
        accessibilityState={{ selected: keyboard.tab === tab.id }}
        style={[s.tab, keyboard.tab === tab.id && s.activeTab]} onPress={() => {
          if (tab.id !== 'ime') Keyboard.dismiss();
          keyboard.selectTab(tab.id);
        }}><Text style={[s.tabLabel, keyboard.tab === tab.id && s.activeText]}>{t(tab.label)}</Text></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel={t("收起键盘")} style={s.close} onPress={dismiss}>
        <Ionicons name="close-circle" size={24} color={color("#ddd", 'faint')} /></Pressable>
    </View>
    {keyboard.tab === 'ime' ? <DesktopIme input={input} />
      : <ScrollView style={{ maxHeight: compact ? 238 : 320 }}
        contentContainerStyle={s.content} keyboardShouldPersistTaps="always">
        {!supported && <Text accessibilityRole="alert" style={s.notice}>{t("更新远程电脑上的应用后，即可使用这些按键。")}</Text>}
        {keyboard.tab === 'shortcuts' ? <View style={s.shortcuts}>
          {desktopShortcuts(platform).map(shortcut => <Pressable key={shortcut.label} accessibilityRole="button"
            accessibilityLabel={`${shortcut.label} ${t(shortcut.description)}`} disabled={!supported}
            style={[s.shortcut, { width: compact ? '15.5%' : '31%' }, !supported && s.disabled]}
            onPress={() => keyboard.shortcut(shortcut.codes)}>
            <Text style={s.shortcutLabel}>{shortcut.label}</Text>
            <Text style={s.description}>{t(shortcut.description)}</Text>
          </Pressable>)}
        </View> : <View style={s.keys}>
          <View style={s.row}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={t("组合键模式")}
              accessibilityState={{ checked: keyboard.combination }} style={s.combination}
              onPress={keyboard.toggleCombination}>
              <Ionicons name={keyboard.combination ? 'checkbox-outline' : 'square-outline'} size={20}
                color={keyboard.combination ? resolveThemeColor('#568aff', 'info') : resolveThemeColor('#ddd', 'faint')} />
              <Text style={s.description}>{t("组合键模式")}</Text></Pressable>
            {desktopModifiers(platform).map(key => <Pressable key={key.code} accessibilityRole="button"
              accessibilityLabel={key.label}
              accessibilityState={{ selected: keyboard.modifiers.includes(key.code), disabled: !supported }}
              disabled={!supported} style={[s.key, keyboard.modifiers.includes(key.code) && s.selected]}
              onPress={() => keyboard.modifier(key.code)}><Text style={s.keyLabel}>{key.label}</Text></Pressable>)}
          </View>
          {KEYBOARD_PAGES[keyboard.page].map((row, index) => <View key={index} style={s.row}>
            {row.map(key => <Pressable key={key.code} accessibilityRole="button" accessibilityLabel={key.label}
              disabled={!supported} style={[s.key, { flex: key.weight ?? 1 }, !supported && s.disabled]}
              onPress={() => keyboard.press(key.code)}><Text style={s.keyLabel}>{key.label}</Text></Pressable>)}
          </View>)}
          <View style={s.pages}>{KEYBOARD_PAGES.map((_, index) => <Pressable key={index}
            accessibilityRole="button" accessibilityLabel={index === 0 ? t("字母键盘") : t("符号和功能键")}
            accessibilityState={{ selected: keyboard.page === index }} style={s.page}
            onPress={() => keyboard.setPage(index)}><View style={[s.dot, keyboard.page === index && s.activeDot]} />
          </Pressable>)}</View>
        </View>}
      </ScrollView>}
  </View>;
}
