import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import {  Text, View } from 'react-native';

export function TotpServiceIcon({ issuer }: { issuer: string }) {
  const styles = useStyles();
  const color = useThemeColor();
  const name = issuer.trim().toLowerCase();
  if (name === 'github') return <View style={styles.github}>
    <Ionicons name="logo-github" size={44} color={color("#202322", 'ink')} />
  </View>;
  if (['aws', 'amazon web services', 'amazon'].includes(name)) return <View style={styles.aws}>
    <FontAwesome5 name="aws" size={32} color={color("#18364d", 'info')} />
  </View>;
  return <View style={styles.initialBadge}>
    <Text style={styles.initial}>{Array.from(issuer.trim())[0]?.toLocaleUpperCase() ?? '?'}</Text>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  github: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  aws: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderRadius: 12, borderWidth: 1, borderColor: color('#eef0f3', 'border'), backgroundColor: color('#fff', 'surface'),
  },
  initialBadge: {
    width: 44, height: 44, borderRadius: 11, backgroundColor: '#ff6b2a',
    alignItems: 'center', justifyContent: 'center',
  },
  initial: { color: '#fff', fontSize: 28, fontWeight: '700' },
}));
