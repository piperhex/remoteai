import type { LoungeController } from './controller';
import type { LoungeAccount, LoungeMessage } from './types';
import type { LoungeReply } from './reply';
import { MobileLoungeHistory } from './MobileLoungeHistory';
import { DesktopLoungeHistory } from './DesktopLoungeHistory';

export interface LoungeHistoryProps {
  controller: LoungeController; open: boolean; close: () => void; preview: (source: string) => void;
  reply: (message: LoungeMessage) => void; direct: (user: LoungeAccount) => void;
  profile?: (user: LoungeAccount) => void; mention?: (user: LoungeAccount) => void;
  mobile?: boolean; locate?: (reference: LoungeReply) => void; navigationError?: string;
}

export function LoungeHistory(props: LoungeHistoryProps) {
  if (props.mobile) return props.open ? <MobileLoungeHistory {...props} /> : null;
  return <DesktopLoungeHistory {...props} />;
}
