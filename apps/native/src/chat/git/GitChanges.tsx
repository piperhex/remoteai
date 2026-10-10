import { gitAreaColors } from './theme';
import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { selectionState } from '../../../../../shared/remote-chat/gitFiles';
import type { GitFileRow } from '../../../../../shared/remote-chat/useGitFileList';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { useGitStyles as useStyles } from './styles';
import { palette } from '../styles';
import { GitSelectionMark, GitTreeIcon } from './GitTreeIcon';

export function GitChanges({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const styles = useStyles();
  const themedColor = useThemeColor();
  useLanguage();
  const files = panel.changes?.files ?? [];
  const list = panel.fileList;
  const count = Object.keys(panel.selected).length;
  const all = selectionState(files, panel.selected);
  return <>
    <View style={styles.selection}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={t("全选")} accessibilityState={{ checked: all }}
        disabled={panel.busy || !files.some(file => !file.conflict)}
        onPress={panel.selectAll} style={styles.checkButton}>
        <GitSelectionMark checked={all} /><Text style={styles.meta}>{t("全选")}</Text></Pressable>
      <Text style={styles.meta}>{t("已选")}{' '}{count}{' '}{t("个文件")}</Text>
      <View style={styles.viewToggle}>{(['tree', 'flat'] as const).map(mode =>
        <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: mode === list.mode }}
          onPress={() => list.setMode(mode)} style={[styles.modeButton, mode === list.mode && styles.activeViewMode]}>
          <Text style={[styles.meta, mode === list.mode && styles.selectedTabText]}>
            {mode === 'tree' ? t("文件夹") : t("平铺")}</Text></Pressable>)}</View>
    </View>
    <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
      {panel.changes && !files.length && <Text style={styles.notice}>{t("工作区没有未提交的改动。")}</Text>}
      {list.rows.map(row => <GitRow key={row.id} row={row} panel={panel} connected={connected}
        flat={list.mode === 'flat'} onToggle={() => list.toggleFolder(row.id)} />)}
    </ScrollView>
    <View style={styles.form}>
      <TextInput accessibilityLabel={t("提交说明")} placeholder={t("填写提交说明")} placeholderTextColor={themedColor(palette.muted, 'muted')}
        style={styles.input} multiline maxLength={4000} value={panel.message} editable={!panel.busy}
        onChangeText={panel.setMessage} />
      <Text style={styles.hint}>{t("提交所选文件的全部改动，包含已暂存和未暂存的内容。")}</Text>
      <Pressable accessibilityRole="button" disabled={!panel.canCommit}
        style={[styles.submit, !panel.canCommit && styles.disabled]} onPress={() => void panel.commit()}>
        <Text style={styles.submitText}>{t("提交")}{' '}{count}{' '}{t("个文件")}</Text></Pressable>
    </View>
  </>;
}

function GitRow({ row, panel, connected, flat, onToggle }: {
  row: GitFileRow; panel: RemoteGit; connected: boolean; flat: boolean; onToggle: () => void;
}) {
  const styles = useStyles();
  const themedColor = useThemeColor();
  useLanguage();
  const checked = selectionState(row.files, panel.selected);
  const folder = row.kind === 'folder';
  const area = row.kind === 'area';
  const tone = gitAreaColors(row.area, themedColor);
  const color = { color: tone.color };
  const disabled = panel.busy || !row.files.some(file => !file.conflict);
  return <View style={[styles.file, area && styles.areaRow,
    !area && checked === true && { backgroundColor: tone.background }]}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={t("选择 {value1}", { value1: row.path })}
      accessibilityState={{ checked, disabled }} disabled={disabled}
      onPress={() => panel.selectFiles(row.files)} style={styles.checkButton}>
      <GitSelectionMark checked={checked} disabled={disabled} /></Pressable>
    {area ? <View style={styles.areaHeading}>
      <View style={[styles.areaDot, { backgroundColor: tone.color }]} />
      <Text style={[styles.areaTitle, color]}>{row.name}</Text>
      <Text style={[styles.areaCount, color, { backgroundColor: tone.background }]}>{row.files.length}</Text>
    </View>
      : <Pressable accessibilityRole="button" accessibilityLabel={`${folder ? t("展开或收起") : t("查看")} ${row.path}`}
        accessibilityState={{ expanded: folder ? !row.collapsed : undefined }}
        disabled={panel.busy || (!folder && !connected)}
        style={[styles.fileButton, { marginLeft: Math.min(row.depth, 4) * 14 }]}
        onPress={() => folder ? onToggle() : panel.setDetail({ kind: 'diff', path: row.path, title: row.path })}>
        {!flat && <View style={styles.chevronSlot}>{folder && <Ionicons
          name={row.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={themedColor(palette.muted, 'muted')} />}</View>}
        <GitTreeIcon folder={folder} />
        <View style={styles.fill}><Text numberOfLines={1} style={[styles.path, color]}>{row.name}</Text>
          {flat && row.path !== row.name && <Text numberOfLines={1} style={styles.meta}>{row.path}</Text>}
          {row.file?.originalPath && <Text style={styles.meta}>{row.file.originalPath} → {row.path}</Text>}</View>
        <Text style={[styles.status, folder ? styles.folderCount
          : [color, { backgroundColor: tone.background }]]}>
          {folder ? row.files.length : row.file?.status.trim()}</Text>
      </Pressable>}
  </View>;
}
