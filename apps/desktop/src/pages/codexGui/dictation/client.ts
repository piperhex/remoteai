import { invoke } from '../../../api/backend';
import { audioBase64 } from '../../../../../../shared/chat/dictation/recording';
import type { DictationClient } from '../../../../../../shared/chat/dictation/client';
import { subscribeGuiEvent } from '../../../../../../shared/conversation/webEvents';

export const dictationClient: DictationClient = {
  subscribeAccountChange: changed => subscribeGuiEvent('codex-gui-account-changed', changed),
  prepare: () => invoke<{ sessionId: string }>('codex_gui_dictation_prepare'),
  cancel: (sessionId: string) => invoke<void>('codex_gui_dictation_cancel', { sessionId }),
  transcribe: async (sessionId: string, audio: Blob) => invoke<{ text: string }>(
    'codex_gui_dictation_transcribe',
    { request: { sessionId, data: await audioBase64(audio), mimeType: audio.type } },
  ),
};
