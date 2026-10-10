import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MOUSE_INSTRUCTIONS, QUALITY_OPTIONS, type DisplaySettingsProps }
  from '../../../../../shared/remote-desktop/displaySettings';
import { t, useLanguage } from '../../i18n';
import { DisplayFrameRateSettings } from './DisplayFrameRateSettings';
import { DisplayMonitorSettings } from './DisplayMonitorSettings';
import { DisplaySettingsHint, DisplaySettingsSection } from './DisplaySettingsSection';
import { displaySettingsStyles as s } from './displaySettingsStyles';

const COMPACT_PANEL_HEIGHT = 300;

export function DisplaySettings(props: DisplaySettingsProps) {
  useLanguage();
  const [compact, setCompact] = useState(false);
  const { settings, update, saving, close } = props;
  return <View style={s.panel} accessibilityLabel={t('显示设置')}
    onLayout={({ nativeEvent }) => setCompact(nativeEvent.layout.height <= COMPACT_PANEL_HEIGHT)}>
    <View style={[s.header, compact && s.compactHeader]}>
      <MaterialCommunityIcons name="monitor" size={30} color="#a8c8ff" />
      <View style={s.headerCopy}><Text style={[s.title, compact && s.compactTitle]}>{t('显示')}</Text>
        {!compact && <Text style={s.description}>{t('调整远程桌面的显示效果')}</Text>}</View>
      <Pressable style={s.close} onPress={close} accessibilityRole="button" accessibilityLabel={t('关闭显示设置')}>
        <MaterialCommunityIcons name="close" size={22} color="#aab6c9" /></Pressable>
    </View>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      indicatorStyle="white" nestedScrollEnabled accessibilityLabel={t('显示设置选项')}>
      <DisplayMonitorSettings {...props} />
      <DisplayFrameRateSettings {...props} />
      <DisplaySettingsSection icon="image-outline" title="画质" description="在画质、流畅度和带宽之间取得平衡">
        <View style={s.options}>{QUALITY_OPTIONS.map(item => <Pressable key={item.value} disabled={saving}
          accessibilityRole="radio" accessibilityState={{ checked: settings.quality === item.value, disabled: saving }}
          style={[s.choice, settings.quality === item.value && s.selected, saving && s.disabled]}
          onPress={() => { void update({ ...settings, quality: item.value }); }}>
          <Text style={s.choiceText}>{t(item.label)}</Text></Pressable>)}</View>
        <DisplaySettingsHint>
          {t('自动模式优先使用最高画质和 60 帧。网络不稳时先降帧，尽量保持清晰。')}
        </DisplaySettingsHint>
      </DisplaySettingsSection>
      <DisplaySettingsSection icon="mouse" title="鼠标操作" description="在远程桌面中使用鼠标的操作方式">
        <View style={s.instructions}>{MOUSE_INSTRUCTIONS.map(text => <View style={s.instruction} key={text}>
          <Text style={s.bullet}>•</Text><Text style={s.instructionText}>{t(text)}</Text>
        </View>)}</View>
      </DisplaySettingsSection>
    </ScrollView>
  </View>;
}
