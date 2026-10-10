import { createThemedStyles } from '../../theme/styles';
import { StyleSheet } from 'react-native';

export const useScrollPadStyles = createThemedStyles((color) => ({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 3 },
  pad: { position: 'absolute' },
  cross: { position: 'absolute', backgroundColor: color('#6a6f77', 'elevated'), borderWidth: 2, borderColor: color('#edf2f7', 'border'), borderRadius: 14 },
  vertical: { left: '33.333%', top: 0, width: '33.333%', height: '100%' },
  horizontal: { left: 0, top: '33.333%', width: '100%', height: '33.333%' },
  center: { position: 'absolute', left: '33.333%', top: '33.333%', width: '33.333%', height: '33.333%',
    backgroundColor: color('#6a6f77', 'elevated') },
  arrow: { position: 'absolute', width: 20, height: 20 },
  knob: { position: 'absolute', borderWidth: 4, borderColor: color('#fff', 'border'), borderRadius: 100, backgroundColor: '#8bb8ff' },
  hint: { position: 'absolute', bottom: 8, alignSelf: 'center', maxWidth: 400, marginHorizontal: 8,
    borderRadius: 8, padding: 10, backgroundColor: '#202634ed' },
  hintText: { color: color('#e7edf8', 'faint'), fontSize: 13 },
}));
