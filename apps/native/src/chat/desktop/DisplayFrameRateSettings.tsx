import { Pressable, Text, TextInput, View } from 'react-native';
import { FRAME_RATE_OPTIONS, type DisplaySettingsProps } from '../../../../../shared/remote-desktop/displaySettings';
import { useFrameRateInput } from '../../../../../shared/remote-desktop/useFrameRateInput';
import { t } from '../../i18n';
import { DisplaySettingsHint, DisplaySettingsSection } from './DisplaySettingsSection';
import { displaySettingsStyles as s } from './displaySettingsStyles';

export function DisplayFrameRateSettings(props: DisplaySettingsProps) {
  const { settings, update, saving } = props;
  const input = useFrameRateInput(props);
  return <DisplaySettingsSection icon="pulse" title="帧率" description="更高的帧率让画面更流畅，也会占用更多带宽">
    <View style={s.options}>
      {FRAME_RATE_OPTIONS.map(fps => <Pressable key={fps} disabled={saving}
        accessibilityRole="radio" accessibilityState={{ checked: settings.fps === fps, disabled: saving }}
        style={[s.choice, settings.fps === fps && s.selected, saving && s.disabled]}
        onPress={() => { void update({ ...settings, fps }); }}>
        <Text style={s.choiceText}>{fps === 'auto' ? t('自动') : t('{value1} 帧', { value1: fps })}</Text>
      </Pressable>)}
    </View>
    <View style={s.custom}>
      <TextInput disableFullscreenUI style={s.input} value={input.custom} onChangeText={input.edit}
        keyboardType="number-pad" maxLength={3} accessibilityLabel={t('自定义帧率')}
        onSubmitEditing={() => { if (!saving) input.apply(); }} />
      <Text style={s.description}>{t('帧')}</Text>
      <Pressable style={[s.apply, saving && s.disabled]} onPress={input.apply} disabled={saving}
        accessibilityRole="button" accessibilityLabel={t('应用帧率')} accessibilityState={{ disabled: saving }}>
        <Text style={s.choiceText}>{t('应用')}</Text></Pressable>
    </View>
    {input.error ? <Text accessibilityRole="alert" style={s.error}>{t(input.error)}</Text>
      : <DisplaySettingsHint>{t('支持 1–144 帧。实际帧率取决于网络和电脑性能。')}</DisplaySettingsHint>}
  </DisplaySettingsSection>;
}
