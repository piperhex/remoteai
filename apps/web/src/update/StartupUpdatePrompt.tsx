import { Dialog, Toast } from 'antd-mobile';
import { useStartupUpdate } from '../../../../shared/app-update/useStartupUpdate';
import { t, useLanguage } from '../i18n';
import { reloadForUpdate, startupUpdateOptions } from './startupUpdate';
import { useIdleWebUpdate } from './useIdleWebUpdate';

export function StartupUpdatePrompt() {
  useLanguage();
  const update = useStartupUpdate(startupUpdateOptions);
  useIdleWebUpdate(update.release?.version);
  if (!update.release) return null;
  const ignore = async () => {
    try {
      await update.ignoreVersion();
    } catch {
      Toast.show({ icon: 'fail', content: t('未能保存，请重试') });
    }
  };
  return <Dialog visible title={t('发现新版本')} closeOnMaskClick={false}
    bodyStyle={{ width: 'calc(100vw - 48px)', maxWidth: 400 }}
    content={t('Remote AI v{version} 已发布，刷新页面即可更新。', { version: update.release.version })}
    actions={[[
      { key: 'ignore', text: t('忽略本版本'), onClick: ignore },
      { key: 'update', text: t('立即更新'), bold: true, onClick: reloadForUpdate },
    ]]} />;
}
