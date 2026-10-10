import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { displayLabel, displayName } from '../../../../../shared/remote-desktop/displays';
import type { DisplaySettingsProps } from '../../../../../shared/remote-desktop/displaySettings';
import { t } from '../../i18n';
import { DisplaySettingsSection } from './DisplaySettingsSection';
import { displaySettingsStyles as s } from './displaySettingsStyles';

export function DisplayMonitorSettings({ displays, settings, saving, update, stats }: DisplaySettingsProps) {
  return <DisplaySettingsSection icon="monitor" title="显示器" description="选择要使用的显示器">
    {displays.length > 0 && <View style={s.monitorGrid}>
      {displays.map(item => <Pressable key={item.id} disabled={saving} accessibilityRole="radio"
        accessibilityLabel={displayLabel(item, t)}
        accessibilityState={{ checked: settings.displayId === item.id, disabled: saving }}
        style={[s.monitorCard, settings.displayId === item.id && s.monitorSelected, saving && s.disabled]}
        onPress={() => { void update({ ...settings, displayId: item.id }); }}>
        <View style={[s.monitorCheck, settings.displayId === item.id && s.monitorChecked]}>
          {settings.displayId === item.id && <MaterialCommunityIcons name="check" size={12} color="#fff" />}
        </View>
        <View style={s.monitorPreview} accessible={false}>
          <View style={s.monitorWave} /><View style={s.monitorShine} />
        </View>
        <Text style={s.monitorName}>{displayName(item, t)}{item.primary && `（${t('主屏')}）`}</Text>
        <Text style={s.monitorResolution}>{item.width} × {item.height}</Text>
      </Pressable>)}
    </View>}
    <Pressable style={s.toggle} accessibilityRole="switch" accessibilityLabel={t('隐藏连接状态')}
      accessibilityState={{ checked: !stats.visible }} onPress={stats.toggle}>
      <MaterialCommunityIcons name="view-dashboard-outline" size={20} color="#7e9bc6" />
      <View style={s.headerCopy}><Text style={s.text}>{t('隐藏连接状态')}</Text>
        <Text style={s.toggleDescription}>{t('连接后不在屏幕上显示状态信息')}</Text></View>
      <View style={[s.switchTrack, !stats.visible && s.switchOn]}>
        <View style={[s.switchThumb, !stats.visible && s.switchThumbOn]} /></View>
    </Pressable>
  </DisplaySettingsSection>;
}
