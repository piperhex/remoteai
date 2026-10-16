import { t, useLanguage } from '../i18n';
import { Button } from 'antd-mobile';
import { Clock3, Eye, EyeOff, Laptop, Plus, RefreshCw, Users } from 'lucide-react';
import { displayDate } from './formatters';
import { QuotaConsumptionButton } from './QuotaConsumptionButton';

export function AccountOverview({ count, online, privateMode, refreshing, updatedAt, onPrivacy, onRefresh, onAdd }: {
  count: number; online: number; privateMode: boolean; refreshing: boolean; updatedAt: number | null;
  onPrivacy: () => void; onRefresh: () => void; onAdd: () => void;
}) {
  useLanguage();
  return <>
    <section className="accounts-overview">
      <header><h1>{t("账户管理")}</h1><button className="icon-button" type="button" onClick={onPrivacy}
        aria-label={privateMode ? t("显示账号邮箱") : t("隐藏账号邮箱")} aria-pressed={privateMode}>
        {privateMode ? <EyeOff size={20} /> : <Eye size={20} />}</button></header>
      <div className="accounts-overview-stats">
        <div><Users size={26} /><span><b>{count}</b><small>{t("个账号")}</small></span></div>
        <div><Laptop size={26} /><span><b>{online}</b><small>{t("在线设备")}</small></span></div>
        <Button color="primary" loading={refreshing} disabled={!count || refreshing} onClick={onRefresh}
          aria-label={t("批量刷新用量")}>
          <RefreshCw size={18} /><span>{t("批量刷新用量")}</span></Button>
      </div>
    </section>
    <div className="accounts-toolbar"><span><Clock3 size={16} />{t("用量更新：")}{updatedAt ? displayDate(new Date(updatedAt).toISOString()) : t("未刷新")}</span>
      <div className="accounts-toolbar-actions"><QuotaConsumptionButton />
        <Button fill="none" color="primary" onClick={onAdd}><Plus size={20} />{t("添加账户")}</Button></div>
    </div>
  </>;
}
