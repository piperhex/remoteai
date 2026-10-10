import { Button, Tooltip } from 'antd';
import { Handshake } from 'lucide-react';
import { guiText } from '../i18n/guiText';
import { assistanceStore } from './store';

export function AssistanceButton() {
  return <Tooltip title={guiText('邀请对方远程控制本机')} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={<Handshake size={16} />} onClick={assistanceStore.open}>
      {guiText('远程协助')}
    </Button>
  </Tooltip>;
}
