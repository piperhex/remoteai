import { bulkAssert } from './bulkLimits';

export type DownloadPhase = 'preparing' | 'downloading' | 'verifying' | 'ready' | 'saving'
  | 'completed' | 'paused' | 'cancelled' | 'failed';
export type DownloadMode = 'bulk' | 'legacy';
const transitions: Record<DownloadPhase, readonly DownloadPhase[]> = {
  preparing: ['downloading', 'paused', 'cancelled', 'failed'],
  downloading: ['verifying', 'paused', 'cancelled', 'failed'],
  verifying: ['ready', 'saving', 'paused', 'cancelled', 'failed'],
  ready: ['saving', 'cancelled', 'failed'],
  saving: ['ready', 'completed', 'paused', 'cancelled', 'failed'],
  completed: [], paused: ['preparing', 'saving', 'cancelled'],
  cancelled: [], failed: ['preparing', 'saving', 'cancelled'],
};

/** Completion is reachable only after whole-file verification AND a successful final save. */
export class DownloadSession {
  private current: DownloadPhase = 'preparing';
  private verified = false;
  private saved = false;
  constructor(readonly mode: DownloadMode, readonly epoch: string) {}
  get phase() { return this.current; }
  fileVerified() { bulkAssert(this.current === 'verifying', 'INVALID_RECORD'); this.verified = true; }
  fileSaved() { bulkAssert(this.current === 'saving' && this.verified, 'INTEGRITY_FAILED'); this.saved = true; }
  move(phase: DownloadPhase) {
    bulkAssert(transitions[this.current].includes(phase), 'INVALID_RECORD');
    if (phase === 'saving' || phase === 'ready') bulkAssert(this.verified, 'INTEGRITY_FAILED');
    if (phase === 'completed') bulkAssert(this.saved, 'STORAGE_FAILED');
    this.current = phase;
  }
}
