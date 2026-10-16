import { Button, Toast } from 'antd-mobile';
import { t, useLanguage } from '../i18n';
import { useAppDispatch, useAppSelector } from '../hooks';
import { consumeAllQuota } from './quotaConsumptionSlice';

export function QuotaConsumptionButton() {
  useLanguage();
  const dispatch = useAppDispatch();
  const { accounts, refreshing } = useAppSelector(state => state.data);
  const { requestId, progress } = useAppSelector(state => state.quotaConsumption);
  const busy = Boolean(requestId);
  const consume = async () => {
    const action = await dispatch(consumeAllQuota(accounts.map(account => account.id)));
    if (consumeAllQuota.fulfilled.match(action)) {
      const { success, failed, skipped, refreshFailed } = action.payload;
      let content = t('完成：成功 {success}，未确认 {failed}，跳过 {skipped}', { success, failed, skipped });
      if (refreshFailed) content += t('；{count} 个账号用量刷新失败', { count: refreshFailed });
      Toast.show({ content, duration: 4000 });
    } else if (!action.meta.condition) {
      Toast.show({ content: t(action.error.message || '额度消耗失败') });
    }
  };
  return <Button className="consume-quota-button" color="primary" loading={busy}
    loadingText={t('消耗中… {done}/{total}', { ...progress })}
    disabled={!accounts.length || refreshing || busy} onClick={() => void consume()}
    aria-label={t('一键消耗')} aria-busy={busy}>
    <span aria-live="polite">{busy
      ? t('消耗中… {done}/{total}', { ...progress }) : t('一键消耗')}</span>
  </Button>;
}
