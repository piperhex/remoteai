import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useContext } from 'react';
import {  Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReviewComment } from '../../../desktop/src/pages/codexGui/messageDirectives';
import { ChatFileContext } from './ChatFilePreview';
import { reviewLocation } from './markdownContent';
import { palette, useStyles } from './styles';
import { SelectableChatText } from './SelectableChatText';
import type { CopyAction } from './CopyTextButton';

export function ChatCodeReview({ comment, copy }: { comment: ReviewComment; copy?: CopyAction }) {
  const reviewStyles = useReviewStyles();
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const openFile = useContext(ChatFileContext);
  const { label, reference } = reviewLocation(comment);
  const open = reference && openFile ? () => openFile(reference) : undefined;
  return <View style={reviewStyles.comment} accessibilityLabel={t("代码审查意见")}>
    <View style={reviewStyles.title}>
      <MaterialCommunityIcons name="file-search-outline" size={16} color={color("#b07824", 'warning')} />
      <Text selectable style={[reviewStyles.text, reviewStyles.titleText, styles.fill]}>{comment.title}</Text>
    </View>
    <Text selectable style={[reviewStyles.text, reviewStyles.body]}>{comment.body}</Text>
    <SelectableChatText style={reviewStyles.text} copy={copy}>
      <Text accessibilityRole={open ? 'link' : undefined} onPress={open}
        style={open && reviewStyles.link}>{label}</Text>
    </SelectableChatText>
  </View>;
}

const useReviewStyles = createThemedStyles((color) => ({
  comment: { borderWidth: 1, borderTopColor: color(palette.border, 'border'), borderRightColor: color(palette.border, 'border'),
    borderBottomColor: color(palette.border, 'border'), borderLeftWidth: 3, borderLeftColor: color('#d39335', 'warning'),
    borderRadius: 8, paddingVertical: 12, paddingHorizontal: 15, marginVertical: 12 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleText: { fontWeight: '700' },
  text: { color: color(palette.ink, 'ink'), fontSize: 13, lineHeight: 22 },
  body: { marginVertical: 10 },
  link: { color: color('#1677ff', 'info') },
}));
