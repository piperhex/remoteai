import { Text, TextInput, View } from 'react-native';
import { t, useLanguage } from '../../i18n';
import type { Turn } from '../types';
import { useTaskReview } from '../../../../../shared/remote-chat/useTaskReview';
import { completedTurnFiles } from '../../../../../shared/chat/turnPresentation';
import { BottomSheet } from '../../components/BottomSheet';
import { ChatDiff } from '../ChatDiff';
import { TaskReviewChecks } from './TaskReviewChecks';
import { TaskReviewDelivery, TaskReviewRestore } from './TaskReviewDelivery';
import { ReviewButton } from './ReviewButton';
import { useStyles } from '../styles';
import { useReviewStyles as useCss } from './styles';

export function TaskReviewPanel({ turn }: { turn: Turn }) {
  const css = useCss();
  const styles = useStyles();
  useLanguage();
  const model = useTaskReview(turn);
  const comment = model.comment;
  return <View>
    {!model.enabled && <Text style={css.notice}>{t('连接电脑后可验证、提交意见和恢复修改。')}</Text>}
    {!!model.error && <Text accessibilityRole="alert" style={css.error}>{t(model.error)}</Text>}
    <ReviewButton label={model.loading ? t('正在加载…') : t('刷新验收结果')}
      disabled={model.loading || !model.enabled} onPress={() => { void model.refresh(); }} />
    <TaskReviewChecks model={model} />
    <View style={css.section}><Text style={styles.title}>{t('本轮改动')}</Text>
      <Text style={css.notice}>{t('点击改动行旁的留言按钮，让原会话继续修改。')}</Text>
      {model.sent && <Text accessibilityLiveRegion="polite" style={css.notice}>{t('意见已发送到原会话。')}</Text>}
      <ChatDiff files={completedTurnFiles(turn)} onComment={model.selectLine} />
    </View>
    <TaskReviewRestore model={model} />
    <TaskReviewDelivery model={model} turn={turn} />
    {comment && <BottomSheet visible title={t('修改意见')} maxWidth={400} onClose={model.closeComment}>
      <View style={css.form}>
        <Text style={css.code}>{comment.file.path} · {t(comment.line.kind === 'remove' ? '修改前' : '修改后')}
          {' '}{comment.line.kind === 'remove' ? comment.line.oldLine : comment.line.newLine}</Text>
        <Text selectable style={css.code}>{comment.line.text}</Text>
        <TextInput accessibilityLabel={t('修改意见')} placeholder={t('这行需要如何修改？')}
          value={model.feedback} multiline style={[css.input, { minHeight: 100 }]} maxLength={8_000}
          onChangeText={model.setFeedback} />
        <ReviewButton label={t('发送到原会话')} disabled={!model.enabled || model.busy || !model.feedback.trim()}
          onPress={() => { void model.sendComment(); }} />
        {!!model.error && <Text accessibilityRole="alert" style={css.error}>{t(model.error)}</Text>}
      </View>
    </BottomSheet>}
  </View>;
}
