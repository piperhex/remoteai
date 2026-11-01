import BUILT_IN_PERMISSION_ZHResource from '@remoteai/i18n/copy/admin/permissions';
import type { Language } from "./i18n";
import type { PermissionDefinition } from "./types";
import { marketText } from '../../../shared/provider-market/i18n';

type PermissionMetadata = Pick<PermissionDefinition, "group" | "name" | "description">;

const BUILT_IN_PERMISSION_ZH: Record<string, PermissionMetadata> = BUILT_IN_PERMISSION_ZHResource;

export function localizePermission(
  permission: PermissionDefinition,
  language: Language,
): PermissionDefinition {
  if (permission.system && permission.code.startsWith('admin.provider-market.')) {
    const t = marketText(language);
    const suffix = permission.code.slice('admin.provider-market.'.length);
    const keys = { manage: 'permissionManage', order: 'permissionOrder', review: 'permissionReview',
      promote: 'permissionPromote', read: 'permissionRead' } as const;
    const key = keys[suffix as keyof typeof keys] ?? 'permissionRead';
    return { ...permission, group: t('market.permissionGroup'), name: t(`market.${key}`),
      description: t(`market.${key}Description`) };
  }
  if (language !== "zh" || !permission.system) return permission;
  const metadata = BUILT_IN_PERMISSION_ZH[permission.code];
  return metadata ? { ...permission, ...metadata } : permission;
}
