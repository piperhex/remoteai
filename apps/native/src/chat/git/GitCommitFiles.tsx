import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GitCommit, GitCommitFile } from '../../../../../shared/remote-chat/gitTypes';
import type { CommitFilesState } from '../../../../../shared/remote-chat/useGitCommitFiles';
import { commitFileStatus } from '../../../../../shared/remote-chat/gitCommitFiles';
import { GitTreeIcon } from './GitTreeIcon';
import { useGitStyles as useStyles } from './styles';
import { palette } from '../styles';

interface Props {
  commit: GitCommit; state: CommitFilesState; connected: boolean; onSelect: (file: GitCommitFile) => void;
}

export function GitCommitFiles({ commit, state, connected, onSelect }: Props) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <>
    <View style={styles.commitHeading}>
      <Text style={styles.subject}>{commit.subject}</Text>
      <Text style={styles.meta}>{commit.hash.slice(0, 8)} · {commit.author} · {
        new Date(commit.date).toLocaleString()}</Text>
      {commit.parents.length > 1 && <Text style={styles.meta}>{t("显示相对第一个父提交的变更")}</Text>}
    </View>
    {state.error && <View>
      <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
      <Pressable accessibilityRole="button" disabled={!connected} style={styles.button} onPress={state.retry}>
        <Text style={styles.buttonText}>{t("重试")}</Text></Pressable>
    </View>}
    {!state.files && !state.error && connected && <ActivityIndicator style={styles.loading} color={color(palette.green, 'accent')} />}
    {state.files && <>
      <Text style={styles.detailTitle}>{t("变更文件")}{' '}{state.files.length}</Text>
      <ScrollView style={styles.fill}>
        {!state.files.length && <Text style={styles.notice}>{t("这次提交没有文件变更。")}</Text>}
        {state.files.map(file => <CommitFile key={file.path} file={file} disabled={!connected}
          onPress={() => onSelect(file)} />)}
      </ScrollView>
    </>}
  </>;
}

function CommitFile({ file, disabled, onPress }: { file: GitCommitFile; disabled: boolean; onPress: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const status = commitFileStatus(file.status);
  const role = file.status === 'D' ? 'danger' : file.status === 'A' ? 'accent' : 'info';
  const textColor = color(status.color, role);
  const background = color(status.background, `${role}Soft`);
  return <Pressable accessibilityRole="button" accessibilityLabel={t("查看 {value1}", { value1: file.path })}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.commitFile, pressed && styles.activeMode]}>
    <GitTreeIcon folder={false} />
    <View style={styles.fill}>
      <Text style={[styles.path, { color: textColor }]}>{file.path.split('/').pop()}</Text>
      {file.path.includes('/') && <Text style={styles.meta}>{file.path}</Text>}
      {file.originalPath && <Text style={styles.meta}>{file.originalPath} → {file.path}</Text>}
    </View>
    <Text style={[styles.commitStatus, { color: textColor, backgroundColor: background }]}>
      {status.label}</Text>
    <Ionicons name="chevron-forward" size={14} color={color(palette.muted, 'muted')} />
  </Pressable>;
}
