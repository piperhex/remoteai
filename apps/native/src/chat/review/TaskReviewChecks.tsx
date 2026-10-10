import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { t, useLanguage } from '../../i18n';
import { checkStatus, type CheckKind } from '../../../../../shared/remote-chat/taskReview';
import type { TaskReviewModel } from '../../../../../shared/remote-chat/useTaskReview';
import { useStyles } from '../styles';
import { useReviewStyles as useCss } from './styles';
import { ReviewButton } from './ReviewButton';

const LABELS = { notRun: '未运行', running: '运行中', passed: '通过', failed: '失败',
  stale: '结果已过期', interrupted: '验证已中断' };

export function TaskReviewChecks({ model }: { model: TaskReviewModel }) {
  const css = useCss();
  const styles = useStyles();
  useLanguage();
  const [confirm, setConfirm] = useState<CheckKind | null>(null);
  const [output, setOutput] = useState<CheckKind | null>(null);
  const snapshot = model.snapshot;
  if (!snapshot) return null;
  const command = snapshot.commands.find(row => row.kind === confirm);
  return <View style={css.section}>
    <Text style={styles.title}>{t('项目验证')}</Text>
    <Text style={css.notice}>{t('验证当前项目代码；聊天中提到的测试结果不会自动记为通过。')}</Text>
    <Text style={css.code}>{t('代码版本')}：{snapshot.revision.head?.slice(0, 8) || t('尚未提交')}
      {' / '}{snapshot.revision.id.slice(0, 10)}</Text>
    {(['build', 'lint', 'test'] as const).map(kind => {
      const plan = snapshot.commands.find(row => row.kind === kind);
      const record = snapshot.checks.find(row => row.kind === kind);
      return <View style={css.stack} key={kind}>
        <View style={css.row}><Text style={[styles.title, styles.fill]}>{kind}</Text>
          <Text style={styles.subtitle}>{t(LABELS[checkStatus(record, snapshot.revision)])}</Text>
          {plan && <ReviewButton label={t('运行验证')} disabled={!model.enabled || model.busy || model.running}
            onPress={() => setConfirm(kind)} />}</View>
        <Text style={css.notice}>{plan?.command || t('项目未配置这项验证。')}</Text>
        {record && <ReviewButton label={t(output === kind ? '收起验证记录' : '查看验证记录')}
          onPress={() => setOutput(output === kind ? null : kind)} />}
        {record && output === kind && <>
          <Text style={css.code}>{record.command} · {record.revision.slice(0, 10)}
            {' · '}{new Date(record.startedAt).toLocaleString()}
            {record.exitCode != null && ` · exit ${record.exitCode}`}</Text>
          <ScrollView style={css.output} nestedScrollEnabled><Text selectable style={css.code}>
            {record.output || t('等待验证完成。')}</Text></ScrollView>
        </>}
      </View>;
    })}
    {command && <View style={css.confirm}>
      <Text style={css.notice}>{t('将在电脑上运行项目命令，可能修改文件或下载依赖。')}</Text>
      <Text style={css.code}>{command.command}</Text>
      <View style={css.row}><ReviewButton label={t('确认运行验证')}
        disabled={!model.enabled || model.busy || model.running}
        onPress={() => { setConfirm(null); void model.run(command.kind); }} />
        <ReviewButton label={t('取消')} onPress={() => setConfirm(null)} /></View>
    </View>}
  </View>;
}
