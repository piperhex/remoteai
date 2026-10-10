import { Pressable, Text, View } from 'react-native';
import type { DisplaySettingsProps } from '../../../../../shared/remote-desktop/displaySettings';
import { t } from '../../i18n';
import { DisplaySettingsHint, DisplaySettingsSection } from './DisplaySettingsSection';
import { displaySettingsStyles as s } from './displaySettingsStyles';

export function DisplayResolutionSettings({ resolution, settings, displays, saving }: DisplaySettingsProps) {
  const current = displays.find(display => display.id === settings.displayId);
  return <DisplaySettingsSection icon="monitor" title="分辨率" description="调整远程电脑的桌面大小">
    {resolution?.options.length ? <View style={s.options}>{resolution.options.map(size => {
      const selected = current?.width === size.width && current?.height === size.height;
      return <Pressable key={`${size.width}x${size.height}`} disabled={saving}
        accessibilityRole="radio" accessibilityLabel={`${size.width} × ${size.height}`}
        accessibilityState={{ checked: selected, disabled: saving }}
        style={[s.choice, selected && s.selected, saving && s.disabled]}
        onPress={() => { void resolution.change(size); }}>
        <Text style={s.choiceText}>{size.width} × {size.height}</Text>
      </Pressable>;
    })}</View> : <DisplaySettingsHint>{t('这台电脑暂不支持切换分辨率。')}</DisplaySettingsHint>}
  </DisplaySettingsSection>;
}
