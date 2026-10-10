import { useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { t, useLanguage } from '../../i18n';
import type { TaskReviewModel } from '../../../../../shared/remote-chat/useTaskReview';
import { resultSummary } from '../../../../../shared/remote-chat/taskReview';
import type { Turn } from '../types';
import { useStyles } from '../styles';
import { useReviewStyles as useCss } from './styles';
import { ReviewButton } from './ReviewButton';

export function TaskReviewDelivery({ model, turn }: { model: TaskReviewModel; turn: Turn }) {
  const css = useCss();
  const styles = useStyles();
  useLanguage();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(resultSummary(turn).slice(0, 80));
  const [body, setBody] = useState(resultSummary(turn));
  const [base, setBase] = useState('');
  const [linkError, setLinkError] = useState('');
  const pr = model.pullRequest;
  const revision = model.snapshot?.revision;
  const current = !!revision && !revision.dirty && pr?.headRefOid === revision.head;
  return <View style={css.section}>
    <Text style={styles.title}>{t('PR 与 CI')}</Text>
    <ReviewButton label={t('刷新 PR 与 CI')} disabled={!model.enabled || model.busy}
      onPress={() => { void model.loadPr(); }} />
    {!!model.prError && <Text accessibilityRole="alert" style={css.error}>{t(model.prError)}</Text>}
    {pr && <>
      <ReviewButton label={`#${pr.number} ${pr.title}`} disabled={!/^https:\/\//i.test(pr.url)}
        onPress={() => { void Linking.openURL(pr.url).catch(() => setLinkError('无法打开链接，请稍后重试。')); }} />
      {!!linkError && <Text style={css.error}>{t(linkError)}</Text>}
      <Text style={css.code}>{t('PR 提交')}：{pr.headRefOid.slice(0, 10)}</Text>
      {!current && <Text style={css.notice}>{t('CI 对应其他代码版本，请提交并推送当前改动后再确认。')}</Text>}
      {!pr.statusCheckRollup?.length && <Text style={css.notice}>{t('暂无 CI 结果。')}</Text>}
      {pr.statusCheckRollup?.map((check, index) => <Text style={styles.messageText} key={index}>
        {check.name || check.context || 'CI'}：{check.conclusion || check.state || check.status || t('待确认')}</Text>)}
    </>}
    {model.prLoaded && !pr && <Text style={css.notice}>{t('当前分支还没有打开的 PR。')}</Text>}
    {!pr && <ReviewButton label={t('创建草稿 PR')} onPress={() => setCreating(!creating)}
      disabled={!model.enabled || model.busy || !revision || revision.dirty} />}
    {revision?.dirty && <Text style={css.notice}>{t('请先通过 Git 入口提交并推送当前改动，再创建 PR。')}</Text>}
    {creating && !pr && <View style={css.form}>
      <Text style={styles.subtitle}>{t('PR 标题')}</Text>
      <TextInput accessibilityLabel={t('PR 标题')} style={css.input} value={title} maxLength={200} onChangeText={setTitle} />
      <Text style={styles.subtitle}>{t('目标分支（留空使用默认分支）')}</Text>
      <TextInput accessibilityLabel={t('目标分支（留空使用默认分支）')} style={css.input} value={base}
        maxLength={200} onChangeText={setBase} />
      <Text style={styles.subtitle}>{t('PR 说明')}</Text>
      <TextInput accessibilityLabel={t('PR 说明')} style={[css.input, { minHeight: 100 }]} value={body}
        multiline maxLength={16_000} onChangeText={setBody} />
      <ReviewButton label={t('确认创建草稿 PR')}
        disabled={!title.trim() || model.busy || !model.enabled || !revision || revision.dirty}
        onPress={() => { void model.createPr({ title, body, base }); }} />
    </View>}
  </View>;
}

export function TaskReviewRestore({ model }: { model: TaskReviewModel }) {
  const css = useCss();
  const styles = useStyles();
  useLanguage();
  return <View style={css.section}>
    <Text style={styles.title}>{t('恢复本轮修改')}</Text>
    <Text style={css.notice}>{t('恢复前检查新改动，发现冲突时不会覆盖文件。')}</Text>
    {model.restored ? <Text style={styles.messageText}>{t('本轮修改已恢复。')}</Text>
      : <ReviewButton label={t('预览恢复影响')} disabled={!model.enabled || model.busy || model.running}
        onPress={() => { void model.previewRestore(); }} />}
    {model.restore && <View style={css.confirm}>
      <Text style={css.notice}>{t(model.restore.conflict ? '文件已有其他修改，无法安全恢复。请先审核差异。'
        : '预览未发现冲突，恢复时会再次检查。')}</Text>
      {model.restore.files.map(path => <Text style={css.code} key={path}>{path}</Text>)}
      <ReviewButton label={t('确认恢复本轮修改')}
        disabled={model.restore.conflict || model.busy || model.running || !model.enabled}
        onPress={() => { void model.confirmRestore(); }} />
    </View>}
  </View>;
}
