import { PROJECT_SEARCH_QUERY_LIMIT, type ProjectBrowserClient } from './protocol';
import type { DocumentsSnapshot } from './documents';
import { withinPath, type BrowserHost, type EntryAction } from './entryActions';
import { validFileSelection } from './fileSelection';
import { displayText } from '../localization/messages';
import { windowRequest } from './windowRequest';

function entryAction(target: Record<string, unknown>): EntryAction {
  if (target.action === 'delete') return { action: 'delete' };
  if (['createFile', 'createFolder', 'rename'].includes(String(target.action))
    && typeof target.name === 'string' && target.name.length <= 255) {
    return { action: target.action as 'createFile' | 'createFolder' | 'rename', name: target.name };
  }
  if ((target.action === 'copy' || target.action === 'move') && typeof target.directory === 'string'
    && target.directory.length <= 4096) return { action: target.action, directory: target.directory };
  throw new Error('操作未完成，请重试。');
}

export interface BrowserSettings {
  type: 'settings'; cwd: string; connected: boolean; labels: Record<string, string>; theme: Record<string, string>;
  language?: import('@remoteai/i18n').EnabledLanguage;
  themeMode?: import('../theme/mode').ThemeMode;
  autoSaveDelay?: number; snapshot?: DocumentsSnapshot;
  scripts?: import('./nativeScripts').NativeScriptState;
  capabilities?: Pick<BrowserHost, 'entryActions' | 'downloadDirectory'> & {
    reference: boolean; quoteSelection: boolean; blame?: boolean;
  };
  ssh?: { path: string; hidden: boolean; busy: boolean; revision: number };
}
export interface BrowserReply { type: 'reply'; id: number; data?: unknown; error?: string }
export type BrowserHostMessage = BrowserSettings | BrowserReply | { type: 'close' };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

async function referenceEntry(target: Record<string, unknown>, path: string, host: BrowserHost) {
  if (!host.reference || typeof target.directory !== 'boolean' || typeof target.name !== 'string'
    || !target.name.trim() || target.name.length > 255 || /[\0\r\n]/.test(target.name)) {
    throw new Error('操作未完成，请重试。');
  }
  await host.reference({ path, name: target.name, directory: target.directory });
}

/** The embedded viewer can only access the project selected by its native host. */
export async function handleBrowserRequest(raw: string, options: {
  client: ProjectBrowserClient; cwd: string; connected: boolean; host?: BrowserHost;
}): Promise<BrowserReply | null> {
  let message: Record<string, unknown>;
  try { message = object(JSON.parse(raw)); } catch { return null; }
  if (message.type !== 'request' || !Number.isSafeInteger(message.id)) return null;
  const id = message.id as number;
  try {
    if (!options.connected) throw new Error('连接已断开，重新连接后即可继续。');
    const target = object(message.body);
    if (message.action === 'list' && (target.directory === undefined || typeof target.directory === 'string')) {
      if (target.query !== undefined && (typeof target.query !== 'string'
        || target.query.length > PROJECT_SEARCH_QUERY_LIMIT || target.query.includes('\0'))) {
        throw new Error('文件搜索失败，请重试。');
      }
      return { type: 'reply', id, data: await options.client.list(options.cwd,
        target.directory as string | undefined, target.query as string | undefined) };
    }
    if (typeof target.path !== 'string' || target.path.length > 4096) throw new Error('文件暂时无法读取，请重试。');
    const file = { cwd: options.cwd, path: target.path };
    if (message.action === 'blame') {
      if (!options.client.blame || typeof target.revision !== 'string' || !target.revision
        || target.revision.length > 256 || !withinPath(file.path, options.cwd)
        || file.path.replace(/\\/g, '/').split('/').includes('..')) {
        throw new Error(displayText('client.gitBlame.unavailable'));
      }
      return { type: 'reply', id, data: await options.client.blame({ ...file, revision: target.revision }) };
    }
    if (message.action === 'mutate') {
      return { type: 'reply', id, data: await options.client.mutate({ ...file, ...entryAction(target) }) };
    }
    if (['copyPath', 'download', 'reference', 'quoteSelection'].includes(String(message.action))) {
      if (!options.host || !withinPath(file.path, options.cwd)
        || file.path.replace(/\\/g, '/').split('/').includes('..')) throw new Error('操作未完成，请重试。');
      if (message.action === 'quoteSelection') {
        if (!options.host.quoteSelection || !validFileSelection(target)) throw new Error('操作未完成，请重试。');
        const { path, start, end, text } = target;
        await options.host.quoteSelection({ path, start, end, text });
        return { type: 'reply', id };
      }
      if (message.action === 'reference') {
        await referenceEntry(target, file.path, options.host);
        return { type: 'reply', id };
      }
      const data = message.action === 'copyPath' ? await options.host.copyPath(file.path)
        : await options.host.download?.(file);
      return { type: 'reply', id, data };
    }
    const window = windowRequest(target.window);
    const readTarget = { ...file, ...(window ? { window } : {}) };
    if (message.action === 'release') {
      await options.client.release?.(readTarget);
      return { type: 'reply', id };
    }
    if (message.action === 'read') return { type: 'reply', id, data: await options.client.read(readTarget) };
    if (message.action !== 'save' || typeof target.text !== 'string'
      || typeof target.revision !== 'string') throw new Error('未能保存文件，请确认文件可写后重试。');
    return { type: 'reply', id,
      data: await options.client.save({ ...readTarget, text: target.text, revision: target.revision }) };
  } catch (error) {
    return { type: 'reply', id,
      error: typeof error === 'string' ? error : error instanceof Error ? error.message : '文件暂时无法读取，请重试。' };
  }
}
