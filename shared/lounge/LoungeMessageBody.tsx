import { LoungeAttachment } from './LoungeAttachment';
import { displayText as t } from '../localization/messages';
import type { LoungeMessage } from './types';
import { LoungeReplyPreview } from './LoungeReplyPreview';
import { LoungeMessageMenu, type LoungeMessageMenuActions } from './LoungeMessageMenu';
import { LoungeDeliveryStatus } from './LoungeDeliveryStatus';
import type { LoungeController } from './controller';
import type { LoungeReply } from './reply';

export function LoungeMessageBody({ message, preview, onImageLoad, actions, controller, locate, mobile,
  showDelivery = true }: {
  message: LoungeMessage; preview: (source: string) => void; onImageLoad?: () => void;
  actions?: LoungeMessageMenuActions;
  mobile?: boolean;
  showDelivery?: boolean;
  controller?: LoungeController; locate?: (reference: LoungeReply) => void;
}) {
  const bubble = <div className={`lounge-bubble${!message.text.trim() && message.images.length && !message.reply
    ? ' image-only' : ''}${message.attachments?.some(file => file.kind === 'file') ? ' has-files' : ''}`}
    tabIndex={actions ? 0 : undefined}>
    {message.reply && <LoungeReplyPreview reply={message.reply} controller={controller} locate={locate} />}
    {message.text && <div className="lounge-text">{message.text}</div>}
    {controller && message.attachments?.map(file => <LoungeAttachment key={file.id} file={file}
      controller={controller} preview={preview} onLoad={onImageLoad} mobile={mobile} />)}
    {message.images.map((source, index) => <button type="button" key={index}
      className="lounge-image" aria-label={t('client.lounge.previewImage')} onClick={() => preview(source)}>
      <img src={source} alt={t('client.lounge.image')} onLoad={onImageLoad} />
    </button>)}
  </div>;
  return <>{actions ? <LoungeMessageMenu mobile={mobile} message={message} {...actions}>{bubble}</LoungeMessageMenu> : bubble}
    {showDelivery && <LoungeDeliveryStatus delivery={message.delivery} />}</>;
}
