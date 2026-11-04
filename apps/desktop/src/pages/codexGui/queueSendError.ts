import { displayError } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";

const IMAGE_INPUT_ERRORS = new Set([
  '图片无法读取，请重新选择后发送。',
  '图片过大，请缩小图片或减少图片后发送。',
]);

export function queueSendError(error: unknown, dispatched: boolean): string {
  const message = error instanceof Error ? error.message : error;
  // Only known pre-send validation failures have a definite outcome and safe display text.
  if (typeof message === 'string' && IMAGE_INPUT_ERRORS.has(message)) return displayError(message);
  return dispatched ? uiText("client.conversation.couldNotConfirmWhetherTheMessageWasSentCheckThe") : uiText("client.conversation.couldNotSendTheMessagePleaseTryAgain");
}
