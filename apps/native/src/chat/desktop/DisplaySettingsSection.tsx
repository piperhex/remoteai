import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { displaySettingsStyles as s } from './displaySettingsStyles';

export function DisplaySettingsSection({ icon, title, description, children }: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string; description: string; children: ReactNode;
}) {
  return <View style={s.section}>
    <View style={s.sectionHeading}>
      <MaterialCommunityIcons name={icon} size={21} color="#83b1ff" />
      <View style={s.headerCopy}><Text style={s.sectionTitle}>{t(title)}</Text>
        <Text style={s.description}>{t(description)}</Text></View>
    </View>{children}
  </View>;
}

export function DisplaySettingsHint({ children }: { children: ReactNode }) {
  return <View style={s.hint}><MaterialCommunityIcons name="information-outline" size={15} color="#aab6c9" />
    <Text style={s.hintText}>{children}</Text></View>;
}
