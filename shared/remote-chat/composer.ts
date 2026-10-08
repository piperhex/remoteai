import type { AccessMode, Model } from './client/types';
import { object } from './protocol';

export type RequestSpeed = 'normal' | 'fast' | 'ultrafast';
export interface ComposerSettings { model: string; effort: string; access: AccessMode; speed?: RequestSpeed }
export const COMPOSER_FIELDS = ['model', 'effort', 'access', 'speed'] as const;
export interface ComposerSnapshot {
  models: Model[]; settings: ComposerSettings; revision: number;
  syncing?: boolean;
  /** Omitted by older hosts; null is the new-conversation draft. */
  threadId?: string | null;
}
export interface ComposerModelsResponse { data: Model[]; nextCursor: string | null; composer?: ComposerSnapshot }
export const COMPOSER_EVENT = 'chat/composer/updated';
export const MODEL_CATALOG_ERROR = '模型列表暂时无法更新，请稍后重试。';
export const DEFAULT_COMPOSER: ComposerSettings = { model: '', effort: '', access: 'workspace-write' };
export function composerThreadId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)) return value;
  throw new Error('请选择聊天后重试。');
}
export const EFFORT_LABELS: Record<string, string> = {
  none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra',
};

export function composerLabel(models: Model[], settings: ComposerSettings, translate = (text: string) => text) {
  const model = models.find((entry) => entry.model === settings.model);
  const name = model?.displayName || settings.model;
  if (!name) return translate('正在同步模型…');
  const effort = translate(EFFORT_LABELS[settings.effort] || settings.effort);
  return effort ? `${name} · ${effort}` : name;
}
export const ACCESS_OPTIONS = [
  { value: 'read-only', label: '请求批准', description: '需要更多权限时，先由你确认。' },
  { value: 'workspace-write', label: '帮我批准', description: '自动判断风险，批准安全操作。' },
  { value: 'danger-full-access', label: '完全访问', description: '可访问电脑上的所有文件和网络，无需逐次确认。' },
] satisfies { value: AccessMode; label: string; description: string }[];

export function composerPatch(value: unknown): Partial<ComposerSettings> {
  const input = object(value);
  if (Object.keys(input).some((key) => !(COMPOSER_FIELDS as readonly string[]).includes(key))) {
    throw new Error('聊天设置无效，请重新选择。');
  }
  for (const key of ['model', 'effort'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 200)) {
      throw new Error('请选择有效的模型和思考深度。');
    }
  }
  if (input.access !== undefined && !ACCESS_OPTIONS.some((option) => option.value === input.access)) {
    throw new Error('请选择有效的访问权限。');
  }
  if (input.speed !== undefined && (typeof input.speed !== 'string'
    || !['normal', 'fast', 'ultrafast'].includes(input.speed))) {
    throw new Error('请选择有效的速度模式。');
  }
  return input as Partial<ComposerSettings>;
}
