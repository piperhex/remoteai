import { Button, Tooltip } from 'antd';
import { Handshake } from 'lucide-react';
import { uiText } from "../../../../shared/localization/uiText";
import { assistanceStore } from './store';

export function AssistanceButton() {
  return <Tooltip title={uiText("client.remoteAssistance.inviteSomeoneToControlThisComputer")} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={<Handshake size={16} />} onClick={assistanceStore.open}>
      {uiText("client.remoteAssistance.remoteAssistance")}
    </Button>
  </Tooltip>;
}
