import { invoke } from '../api/backend';
import { object } from '../../../../shared/remote-chat/protocol';
import type { FilePreviewData } from '../../../../shared/remote-chat/files';
import { PREVIEW_CHUNK_CHARACTERS } from '../../../../shared/remote-chat/filePreviewText';
import { RemoteMappingStreams } from '../../../../shared/port-mapping/remoteStreams';
import { STREAM_OPERATION, type MappingStreamLink } from '../../../../shared/port-mapping/streamMux';
import { checkFilePreviewSize } from '../../../../shared/remote-chat/policy';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

interface Resource { kind: 'preview' | 'resource'; id?: string; text?: string }
const MAX_RESOURCES = 16;
const unavailable = () => new Error('连接已断开，请重新打开预览。');

/** Handles belong to the authenticated transport owner, never to an owner supplied in a request body. */
export class RemoteFiles {
  private readonly owners = new Map<string, Set<Resource>>();
  private readonly streams = new Map<string, RemoteMappingStreams>();
  attach(owner: string, link: MappingStreamLink) {
    this.streams.get(owner)?.close(); this.streams.set(owner, new RemoteMappingStreams(link));
  }

  async request(body: Record<string, unknown>, owner: string, mode: ConnectionMode = 'relay'): Promise<unknown> {
    if (body.operation === 'guiFileApplications') return invoke('codex_gui_file_applications');
    if (body.operation === 'guiFileAction') {
      // Saving on the viewer uses its download manager, not an unattended dialog on the host.
      if (!['open', 'copyFile', 'copyPath', 'copyContents', 'reveal', 'metadata'].includes(String(object(body.action).type))) {
        throw new Error('请选择有效的文件操作。');
      }
      return invoke('codex_gui_file_action', { request: { target: body.target, action: body.action } });
    }
    if (body.operation === 'guiFilePreviewOpen' || body.operation === 'guiResourceOpen') return this.open(body, owner, mode);
    const resourceId = body.operation === STREAM_OPERATION ? body.resource : body.id;
    const resource = [...(this.owners.get(owner) ?? [])].find(value => value.id === resourceId);
    const closing = body.operation === 'guiFilePreviewClose' || body.operation === 'guiResourceClose';
    if (!resource) { if (closing) return; throw unavailable(); }
    const preview = String(body.operation).startsWith('guiFilePreview');
    if (preview !== (resource.kind === 'preview')) throw unavailable();
    if (body.operation === 'guiFilePreviewText') return previewText(resource, body);
    if (closing) {
      this.owners.get(owner)?.delete(resource);
      if (resource.id) this.streams.get(owner)?.closeResource(resource.id);
      return close(resource);
    }
    if (body.operation === STREAM_OPERATION) {
      const streams = this.streams.get(owner);
      if (!streams) throw unavailable();
      return streams.request(body);
    }
    if (body.operation === 'guiFilePreviewHost') {
      return invoke('codex_gui_file_preview_host', { sessionId: resource.id, host: body.host });
    }
    if (body.operation !== 'guiResourceLink') throw unavailable();
    const request = object(body.request);
    if (!['connect', 'read', 'write', 'close', 'udpConnect', 'udpRead', 'udpWrite', 'udpClose']
      .includes(String(request.type))) throw unavailable();
    return invoke('codex_gui_resource_link', { request: { ...request, scope: resource.id } });
  }

  private async open(body: Record<string, unknown>, owner: string, mode: ConnectionMode) {
    const resources = this.owners.get(owner) ?? new Set<Resource>();
    if (resources.size >= MAX_RESOURCES) throw new Error('预览较多，请先关闭一个再试。');
    this.owners.set(owner, resources);
    const resource: Resource = { kind: body.operation === 'guiFilePreviewOpen' ? 'preview' : 'resource' };
    resources.add(resource);
    try {
      const result = resource.kind === 'preview'
        ? await invoke<FilePreviewData | null>('codex_gui_open_file_preview', { target: body.target })
        : await invoke<string>('codex_gui_resource_open', { url: body.url });
      resource.id = typeof result === 'string' ? result : result?.sessionId;
      if (!resources.has(resource)) throw unavailable();
      if (result && typeof result !== 'string' && result.kind === 'pdf') checkFilePreviewSize(result.size!, mode);
      if (!result) resources.delete(resource);
      if (body.chunkedText === true && result && typeof result !== 'string'
        && result.text && result.text.length > PREVIEW_CHUNK_CHARACTERS) {
        resource.text = result.text;
        return { ...result, text: null, textLength: result.text.length };
      }
      return result;
    } catch (error) {
      resources.delete(resource);
      await close(resource).catch(() => console.warn('Preview cleanup failed'));
      throw error;
    }
  }

  release(owner?: string) {
    for (const [key, streams] of this.streams) {
      if (owner !== undefined && key !== owner) continue;
      this.streams.delete(key); streams.close();
    }
    for (const [key, resources] of this.owners) {
      if (owner !== undefined && key !== owner) continue;
      this.owners.delete(key);
      for (const resource of resources) void close(resource).catch(() => console.warn('Preview cleanup failed'));
      resources.clear();
    }
  }
}

function previewText(resource: Resource, body: Record<string, unknown>) {
  const { offset, length } = body;
  if (resource.text === undefined || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    || typeof length !== 'number' || !Number.isSafeInteger(length) || length <= 0
    || length > PREVIEW_CHUNK_CHARACTERS || offset + length > resource.text.length) throw unavailable();
  return { offset, text: resource.text.slice(offset, offset + length) };
}

async function close(resource: Resource) {
  if (!resource.id) return;
  if (resource.kind === 'preview') await invoke('codex_gui_close_file_preview', { sessionId: resource.id });
  else await invoke('codex_gui_resource_link', { request: { type: 'stop', scope: resource.id } });
}
