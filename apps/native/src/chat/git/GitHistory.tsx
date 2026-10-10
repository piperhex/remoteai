import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { gitGraph, GRAPH_ROW_HEIGHT, type GraphLine, type GraphRow } from '../../../../../shared/remote-chat/gitGraph';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { useGitStyles as useStyles } from './styles';

function Line({ line }: { line: GraphLine }) {
  useLanguage();
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  return <View style={{ position: 'absolute', height: 2, width: length, backgroundColor: line.color,
    left: (line.x1 + line.x2) / 2 - length / 2, top: (line.y1 + line.y2) / 2 - 1,
    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
}

function Graph({ row, width }: { row: GraphRow; width: number }) {
  const color = useThemeColor();
  useLanguage();
  return <View accessible={false} style={{ width, height: GRAPH_ROW_HEIGHT }}>
    {row.lines.map((line, index) => <Line key={index} line={line} />)}
    <View style={{ position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: row.color,
      borderColor: color('#fff', 'border'), borderWidth: 1, left: row.x - 4.5, top: GRAPH_ROW_HEIGHT / 2 - 4.5 }} />
  </View>;
}

export function GitHistory({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const styles = useStyles();
  useLanguage();
  const graph = useMemo(() => gitGraph(panel.commits), [panel.commits]);
  return <ScrollView style={styles.fill}>
    {!panel.busy && !panel.commits.length && <Text style={styles.notice}>{t("还没有提交记录。")}</Text>}
    <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16 }}>
      <View>{graph.rows.map(row => <Pressable key={row.commit.hash} accessibilityRole="button"
        accessibilityLabel={`${row.commit.hash.slice(0, 8)} ${row.commit.subject}`} style={styles.historyRow}
        disabled={!connected || panel.busy} onPress={() => panel.setDetail({ kind: 'files', commit: row.commit })}>
        <Graph row={row} width={graph.width} />
        <View style={styles.historyText}><Text numberOfLines={1} style={styles.subject}>{row.commit.subject}</Text>
          {!!row.commit.refs.length && <View style={styles.refs}>{row.commit.refs.map(ref =>
            <Text key={ref} numberOfLines={1} style={styles.ref}>{ref}</Text>)}</View>}
          <Text numberOfLines={1} style={styles.meta}>{row.commit.hash.slice(0, 8)} · {row.commit.author} · {
            new Date(row.commit.date).toLocaleString()}</Text>
        </View>
      </Pressable>)}</View>
    </ScrollView>
    {panel.hasMore && <Pressable accessibilityRole="button" style={styles.button} disabled={panel.busy || !connected}
      onPress={() => void panel.more()}><Text style={styles.buttonText}>{t("加载更多提交")}</Text></Pressable>}
  </ScrollView>;
}
