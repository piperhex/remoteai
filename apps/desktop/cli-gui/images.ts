import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES } from '../../../shared/chat/draftImages';
import { MAX_CHAT_IMAGE_CHARS } from '../../../shared/remote-chat/attachments';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const SOURCE_PREFIX = 'chat-image://';
const MAX_ENCODED_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
interface MessageImages { images: string[]; text: string }

/** Validate untrusted IPC before constructing native SDK image blocks or touching storage. */
export function cliImages(value: unknown): { data: string; mimeType: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw new Error('client.cliGui.invalidRequest');
  if (value.some(url => typeof url !== 'string')
    || value.reduce((size, url) => size + url.length, 0) > MAX_CHAT_IMAGE_CHARS) {
    throw new Error('client.cliGui.invalidRequest');
  }
  return value.map(url => {
    if (typeof url !== 'string' || url.length > MAX_ENCODED_BYTES + 64) {
      throw new Error('client.cliGui.invalidRequest');
    }
    const comma = url.indexOf(',');
    const mimeType = url.slice(5, comma - 7);
    const data = url.slice(comma + 1);
    if (!IMAGE_TYPES.includes(mimeType) || !url.startsWith(`data:${mimeType};base64,`)
      || !data.length || data.length > MAX_ENCODED_BYTES) throw new Error('client.cliGui.invalidRequest');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== data) {
      throw new Error('client.cliGui.invalidRequest');
    }
    return { mimeType, data };
  });
}

/** Session-scoped content addresses keep paths private and history pages small. */
export class CliImages {
  constructor(private readonly root: string) {}
  private directory(id: string) { return join(this.root, 'images', hash(id)); }

  async has(id: string) {
    try { return (await stat(this.directory(id))).isDirectory(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async save(id: string, messageId: string, value: MessageImages, ordinal: number) {
    const directory = this.directory(id);
    await mkdir(directory, { recursive: true });
    const sources: string[] = [];
    for (const url of value.images) {
      const digest = hash(url);
      await writeFile(join(directory, `${digest}.image`), url, { flag: 'wx', mode: 0o600 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
      sources.push(SOURCE_PREFIX + digest);
    }
    const contents = JSON.stringify({ text: value.text, images: sources });
    await this.write(join(directory, `${hash(messageId)}.json`), contents);
    await this.write(join(directory, `ordinal-${ordinal}.json`), contents);
  }

  private async write(target: string, contents: string) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, target);
  }

  async message(id: string, ordinal: number, messageId?: string): Promise<MessageImages | undefined> {
    const directory = this.directory(id);
    const direct = messageId ? await this.read(join(directory, `${hash(messageId)}.json`)) : undefined;
    return direct ?? this.read(join(directory, `ordinal-${ordinal}.json`));
  }

  private async read(path: string): Promise<MessageImages | undefined> {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async load(id: string, source: string) {
    if (!/^chat-image:\/\/[a-f0-9]{64}$/.test(source)) throw new Error('client.cliGui.invalidRequest');
    return readFile(join(this.directory(id), `${source.slice(SOURCE_PREFIX.length)}.image`), 'utf8');
  }
}
