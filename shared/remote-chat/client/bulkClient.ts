import { BULK_OPERATION, type BulkClient } from '../bulkControl';
import { getChatPolicy } from '../policy';
import type { ChatLink } from '../link';
import { BulkError, bulkError } from '../bulkLimits';

export function downloadBulkClient(options: {
  peer: () => string; link: () => ChatLink | undefined; supported: () => boolean;
  request: <T>(body: object) => Promise<T>;
}): BulkClient {
  const request = <T>(body: object) => options.request<T>(body).catch(error => { throw bulkError(error); });
  const cancel = (transferId: string, epoch: string) =>
    request<void>({ operation: BULK_OPERATION, action: 'cancel', transferId, epoch });
  return {
    get peer() { return options.peer(); },
    available: () => getChatPolicy().fileBulkEnabled === 1 && options.supported()
      && !!options.link()?.bulk?.path,
    path: () => options.link()?.bulk?.path,
    transport: () => options.link()?.bulk,
    open: (open, signal) => new Promise((resolve, reject) => {
      const abort = () => {
        reject(new BulkError('CANCELLED'));
        void cancel(open.transferId, open.epoch).catch(() => console.warn('Cancelled transfer will expire.'));
      };
      if (signal?.aborted) { reject(new BulkError('CANCELLED')); return; }
      signal?.addEventListener('abort', abort, { once: true });
      void request<import('../bulkControl').BulkOpened>({ operation: BULK_OPERATION, action: 'open', ...open })
        .then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
    }),
    page: (transferId, page) => request({ operation: BULK_OPERATION, action: 'page', transferId, page }),
    request: body => request({ operation: BULK_OPERATION, action: 'request', ...body }),
    cancel,
    cipher: context => {
      const link = options.link();
      if (!link) throw new Error('下载连接已中断，请继续下载。');
      return link.createBulkCipher(context);
    },
  };
}
