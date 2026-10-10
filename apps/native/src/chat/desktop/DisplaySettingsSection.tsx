import { useThemeColor } from '../../theme/store';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { useDisplaySettingsStyles as useS } from './displaySettingsStyles';

export function DisplaySettingsSection({ icon, title, description, children }: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string; description: string; children: ReactNode;
}) {
  const s = useS();
  const color = useThemeColor();
  return <View style={s.section}>
    <View style={s.sectionHeading}>
      <MaterialCommunityIcons name={icon} size={21} color={color("#83b1ff", 'info')} />
      <View style={s.headerCopy}><Text style={s.sectionTitle}>{t(title)}</Text>
        <Text style={s.description}>{t(description)}</Text></View>
    </View>{children}
  </View>;
}

export function DisplaySettingsHint({ children }: { children: ReactNode }) {
  const s = useS();
  const color = useThemeColor();
  return <View style={s.hint}><MaterialCommunityIcons name="information-outline" size={15} color={color("#aab6c9", 'faint')} />
    <Text style={s.hintText}>{children}</Text></View>;
}
