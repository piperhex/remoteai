import { displayError } from '../i18n/index';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { IMAGE_AI_TOOLS } from '../../../../shared/chat/imageAiEdit';
import { useImageAiEdit } from '../../../../shared/chat/useImageAiEdit';
import { t } from '../i18n';

const icons = ['draw', 'comment-plus-outline', 'image-filter-center-focus', 'eraser', 'resize'] as const;
interface Props {
  load: () => Promise<string>; close: () => void;
}
export function ImageAiToolbar({ load, close }: Props) {
  const editor = useImageAiEdit({ load, close });
  if (!editor.available) return null;
  const selected = IMAGE_AI_TOOLS.find(item => item.id === editor.tool);
  return <View>
    {selected && <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t(selected.label)}</Text>
      <Text style={styles.text}>{t(selected.hint)}</Text>
      <TextInput accessibilityLabel={t(selected.hint)} value={editor.detail} onChangeText={editor.setDetail}
        editable={!editor.busy} multiline maxLength={2000} style={[styles.input, styles.detail]} />
      {editor.tool === 'resize' && <View style={styles.dimensions}>
        <View style={styles.dimension}><Text style={styles.text}>{t("client.imageAi.widthPixels")}</Text>
          <TextInput accessibilityLabel={t("client.imageAi.widthPixels")} keyboardType="number-pad" value={editor.width}
            editable={!editor.busy} onChangeText={editor.setWidth} style={styles.input} /></View>
        <View style={styles.dimension}><Text style={styles.text}>{t("client.imageAi.heightPixels")}</Text>
          <TextInput accessibilityLabel={t("client.imageAi.heightPixels")} keyboardType="number-pad" value={editor.height}
            editable={!editor.busy} onChangeText={editor.setHeight} style={styles.input} /></View>
      </View>}
      <Text style={styles.text}>{t("client.imageAi.theEditedImageWillAppearInThisConversation")}</Text>
      {!!editor.error && <Text accessibilityRole="alert" style={styles.text}>{displayError(editor.error)}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={editor.busy} style={styles.button}
          onPress={() => editor.select(null)}><Text style={styles.text}>{t("client.accounts.cancel")}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={editor.busy || !editor.enabled} style={styles.button}
          onPress={() => void editor.submit()}><Text style={styles.text}>
          {t(editor.busy ? "client.imageAi.submitting" : "client.imageAi.editWithAi")}</Text></Pressable>
      </View>
    </ScrollView>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar}
      contentContainerStyle={styles.tools} keyboardShouldPersistTaps="handled" directionalLockEnabled
      alwaysBounceHorizontal={false}>
      {IMAGE_AI_TOOLS.map((item, index) => <Pressable key={item.id} accessibilityRole="button"
        accessibilityLabel={t(item.label)} accessibilityState={{ selected: item.id === editor.tool,
          disabled: editor.busy || !editor.enabled }} disabled={editor.busy || !editor.enabled}
        onPress={() => editor.select(item.id)} style={[styles.tool, item.id === editor.tool && styles.selected,
          (editor.busy || !editor.enabled) && styles.disabled]}>
        <MaterialCommunityIcons name={icons[index]} size={20} color="#ddd" />
        <Text style={styles.label} numberOfLines={1}>{t(item.label)}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  toolbar: { borderRadius: 18, backgroundColor: '#2c2c2c', flexGrow: 0 },
  tools: { flexGrow: 1, justifyContent: 'space-around', padding: 4 },
  tool: { alignItems: 'center', justifyContent: 'center', minHeight: 56, paddingHorizontal: 10, gap: 4,
    borderRadius: 12, flexShrink: 0 },
  selected: { backgroundColor: '#454545' }, disabled: { opacity: 0.45 },
  label: { fontSize: 12, color: '#ddd' }, text: { color: '#ddd', fontSize: 14 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600', marginBottom: 12 },
  form: { alignSelf: 'center', width: '100%', maxWidth: 400, maxHeight: 300, padding: 16,
    marginBottom: 12, borderRadius: 16, backgroundColor: '#2c2c2c' },
  input: { color: '#fff', backgroundColor: '#181818', borderRadius: 8, borderWidth: 1,
    borderColor: '#666', padding: 8, marginVertical: 8, minHeight: 44 },
  detail: { minHeight: 70, textAlignVertical: 'top' }, dimensions: { flexDirection: 'row', gap: 12 },
  dimension: { flex: 1 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingBottom: 24 },
  button: { padding: 12, minHeight: 44, justifyContent: 'center' },
});
