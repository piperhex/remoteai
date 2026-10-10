import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetFlatList, SheetInset, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import { directoryProject, type ProjectPickerProps } from '../../../../shared/remote-chat/projectDirectories';
import { useProjectDirectories } from '../../../../shared/remote-chat/client/useProjectDirectories';

export function ChatProjectPicker(props: ProjectPickerProps) {
  const pickerStyles = usePickerStyles();
  const color = useThemeColor();
  useLanguage();
  const { result, loading, error, browse, retry } = useProjectDirectories(props);
  return <BottomSheet fullWidthContent visible title={t("选择项目")} onClose={props.close} dragFromHeaderOnly
    actions={[{ label: t("选择此文件夹"), tone: 'primary', disabled: loading || !result?.directory,
      onPress: () => { if (result?.directory) props.choose(directoryProject(result.directory)); } }]}>
    <View style={pickerStyles.root}>
      <SheetInset style={pickerStyles.readable}>
        <Text numberOfLines={2} style={pickerStyles.message}>{result?.directory || t("此电脑")}</Text>
        <View style={pickerStyles.navigation}>
          <Pressable accessibilityRole="button" disabled={loading} onPress={() => browse('')}>
            <Text style={pickerStyles.link}>{t("此电脑")}</Text></Pressable>
          {result?.parent != null && <Pressable accessibilityRole="button" disabled={loading}
            onPress={() => browse(result.parent ?? '')}><Text style={pickerStyles.link}>{t("返回上一级")}</Text></Pressable>}
        </View>
        {loading && <ActivityIndicator accessibilityLabel={t("正在读取文件夹")} style={pickerStyles.message} />}
        {!!error && <View><Text accessibilityRole="alert" style={pickerStyles.message}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={retry}><Text style={pickerStyles.link}>{t("重试")}</Text></Pressable>
        </View>}
      </SheetInset>
      <SheetFlatList data={result?.entries ?? []} keyExtractor={(entry) => entry.path} style={pickerStyles.list}
        contentContainerStyle={pickerStyles.readable}
        keyboardShouldPersistTaps="handled" nestedScrollEnabled
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name}
          disabled={loading} onPress={() => browse(item.path)} style={pickerStyles.row}>
          <Feather name="folder" size={21} color={color("#6f8177", 'muted')} />
          <Text numberOfLines={1} style={pickerStyles.name}>{item.name}</Text>
          <Feather name="chevron-right" size={18} color={color("#6f8177", 'muted')} />
        </Pressable>}
        ListEmptyComponent={!loading && !error ? <Text style={pickerStyles.message}>{t("此处没有子文件夹")}</Text> : null}
        ListFooterComponent={result?.truncated
          ? <Text style={pickerStyles.message}>{t("文件夹较多，仅显示部分结果。")}</Text> : null} />
    </View>
  </BottomSheet>;
}

const usePickerStyles = createThemedStyles((color) => ({
  root: { flexShrink: 1 },
  readable: { width: '100%', maxWidth: SHEET_READABLE_WIDTH, alignSelf: 'center' },
  list: { maxHeight: 340, flexGrow: 0 },
  navigation: { flexDirection: 'row', gap: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, minHeight: 48 },
  // Leave room for Android font metrics and descenders when truncating to one line.
  name: { flex: 1, color: color('#13231c', 'ink'), fontSize: 15, lineHeight: 22,
    includeFontPadding: true, paddingVertical: 2 },
  message: { color: color('#6f8177', 'muted'), fontSize: 13, lineHeight: 20, padding: 12 },
  link: { color: color('#14806f', 'accent'), fontSize: 13, lineHeight: 20, includeFontPadding: true, padding: 12 },
}));
