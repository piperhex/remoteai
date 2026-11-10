import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { InstallationProgress } from '../../../shared/cli/installProgressTypes';

export type ReportProgress = (progress: InstallationProgress) => void;
const RESPONSE_CHANNEL = 'http.client.response.finish';
export const PROGRESS_REPORT_INTERVAL_MS = 100;

export function isInstallationProgress(value: unknown): value is InstallationProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Record<string, unknown>;
  return ['preparing', 'downloading', 'installing', 'verifying'].includes(String(progress.phase))
    && Number.isSafeInteger(progress.downloaded) && Number(progress.downloaded) >= 0
    && (progress.total === undefined || Number.isSafeInteger(progress.total) && Number(progress.total) > 0)
    && (progress.fileName === undefined || typeof progress.fileName === 'string' && progress.fileName.length <= 200);
}

/** Observe npm's actual archive transfers without replacing its fetch, cache, integrity checks or streams. */
export function observePackageDownloads(report: ReportProgress) {
  const active = new Map<IncomingMessage, InstallationProgress>();
  let selected: IncomingMessage | undefined;
  let lastReport = 0;
  const publish = (progress: InstallationProgress, force = false) => {
    if (!force && Date.now() - lastReport < PROGRESS_REPORT_INTERVAL_MS) return;
    lastReport = Date.now(); report({ ...progress });
  };
  const observe = (value: unknown) => {
    const { request, response } = value as { request: ClientRequest; response: IncomingMessage };
    if (request.getHeader('host') !== 'registry.npmjs.org' || request.method !== 'GET'
      || !request.path.split('?')[0].endsWith('.tgz') || response.statusCode !== 200) return;
    const length = Number(response.headers['content-length']);
    const progress: InstallationProgress = { phase: 'downloading', downloaded: 0,
      total: Number.isSafeInteger(length) && length > 0 ? length : undefined,
      fileName: request.path.split('?')[0].split('/').pop()?.slice(0, 200) };
    active.set(response, progress);
    selected ??= response;
    if (selected === response) publish(progress, true);
    response.on('data', (chunk: Buffer) => {
      progress.downloaded += chunk.length;
      if (selected === response) publish(progress);
    });
    response.once('end', () => finish(response, true));
    response.once('close', () => finish(response, false));
  };
  const finish = (response: IncomingMessage, completed: boolean) => {
    const progress = active.get(response);
    if (!progress) return;
    active.delete(response);
    if (selected !== response) return;
    selected = active.keys().next().value;
    const next = selected ? active.get(selected) : undefined;
    if (next) publish(next, true);
    else publish({ ...progress, phase: completed ? 'installing' : 'preparing',
      total: completed ? progress.downloaded || undefined : progress.total }, true);
  };
  subscribe(RESPONSE_CHANNEL, observe);
  return () => { unsubscribe(RESPONSE_CHANNEL, observe); active.clear(); };
}
