import { Text, View } from 'react-native';
import { connectionEndpointRows } from '../../../../shared/remote-chat/connectionEndpoints';
import { publicEndpointRows } from '../../../../shared/remote-chat/publicEndpoints';
import { t } from '../i18n';
import { useHealthStyles as useCss } from './connectionHealthStyles';
import type { ChatState } from './types';

export function ChatConnectionAddresses({ state }: { state: ChatState }) {
  const css = useCss();
  const current = connectionEndpointRows(state.mode, state.directEndpoints);
  return <>
    {current.length > 0 && <View style={css.addresses}>
      <Text style={css.label}>{t('当前 P2P 连接')}</Text>
      {current.map(row => <View key={row.id} style={css.addressRow}>
        <Text style={css.label}>{t(row.label)}</Text>
        {row.address ? <Text selectable style={css.address}>{row.address}</Text>
          : <Text style={css.detail}>{t('暂无法获取')}</Text>}
      </View>)}
      <Text style={css.detail}>{t('优先显示当前连接对应的公网地址，无法确认时显示本地地址。')}</Text>
    </View>}
    <View style={css.addresses}>
      {publicEndpointRows(state.publicEndpoints).map(row => <View key={row.id} style={css.addressRow}>
        <Text style={css.label}>{t(row.label)}</Text>
        {row.addresses.length ? row.addresses.map(address =>
          <Text key={address} selectable style={css.address}>{address}</Text>)
          : <Text style={css.detail}>{t('尚未识别')}</Text>}
      </View>)}
      <Text style={css.detail}>{t('显示本次连接识别到的公网地址。')}</Text>
    </View>
  </>;
}
