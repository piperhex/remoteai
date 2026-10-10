import { useThemeColor } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { ComposerPlugin } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import type { RemoteComposerCatalog } from '../../../../shared/remote-chat/composerCatalog';
import type { Skill } from './types';
import { skillLabel, type SkillCatalogState } from './skillCatalog';

interface Props {
  catalog: SkillCatalogState;
  query: string;
  load: () => Promise<RemoteComposerCatalog>;
  chooseSkill: (skill: Skill) => void;
  choosePlugin: (plugin: ComposerPlugin) => void;
}
type Entry = { key: string; label: string; name: string; skill?: Skill; plugin?: ComposerPlugin };
function entryIcon(name: string): React.ComponentProps<typeof Feather>['name'] {
  if (/image|photo|图/i.test(name)) return 'image';
  if (/task|任务/i.test(name)) return 'check-square';
  if (/github/i.test(name)) return 'github';
  if (/draw|canvas|design|绘/i.test(name)) return 'edit-3';
  return 'box';
}

export function ComposerPluginMenu({ catalog, query, load, chooseSkill, choosePlugin }: Props) {
  const resolveThemeColor = useThemeColor();
  const pluginStyles = usePluginStyles();
  useLanguage();
  const [result, setResult] = useState<RemoteComposerCatalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void load().then((value) => { if (!cancelled) { setResult(value); setError(value.pluginsError ?? ''); } })
      .catch(() => { if (!cancelled) setError(t("暂时无法更新插件，可继续选择已有内容。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);
  const skills = result?.data.flatMap((group) => group.skills) ?? catalog.skills;
  const entries: Entry[] = [
    ...(result?.plugins ?? []).map((plugin) => ({ key: `plugin:${plugin.id}`, plugin,
      label: plugin.interface?.displayName || plugin.name, name: plugin.name })),
    ...skills.filter((skill) => skill.enabled).map((skill) => ({ key: skill.path, skill,
      label: skillLabel(skill), name: skill.name })),
  ].filter((entry) => `${entry.label} ${entry.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <View accessibilityLabel={t("插件列表")} style={pluginStyles.root}>
    <Text style={pluginStyles.heading}>{t("插件")}</Text>
    <FlatList data={entries} keyExtractor={(entry) => entry.key} keyboardShouldPersistTaps="always"
      style={pluginStyles.list} nestedScrollEnabled
      renderItem={({ item, index }) => <Pressable accessibilityRole="menuitem"
        accessibilityLabel={t("使用{value1} {value2}", { value1: item.skill ? '技能' : '插件', value2: item.label })}
        onPress={() => { if (item.skill) chooseSkill(item.skill); else if (item.plugin) choosePlugin(item.plugin); }}
        style={({ pressed }) => [pluginStyles.option, (pressed || index === 0) && pluginStyles.highlight]}>
        <Feather name={entryIcon(item.name)} size={22} color={/image/i.test(item.name) ? resolveThemeColor('#41b8dc', 'info') : resolveThemeColor('#161616', 'ink')} />
        <Text numberOfLines={1} style={pluginStyles.label}>{item.label}</Text>
      </Pressable>}
      ListFooterComponent={<>
        {loading && !entries.length && <Text style={pluginStyles.message}>{t("正在加载插件…")}</Text>}
        {!loading && !entries.length && !error && <Text style={pluginStyles.message}>
          {query ? t("没有找到匹配的插件") : t("暂无可用插件或技能")}</Text>}
        {!!error && <Text style={pluginStyles.message}>{error}</Text>}
      </>} />
  </View>;
}

const usePluginStyles = createThemedStyles((color) => ({
  root: { flexShrink: 1 },
  heading: { fontSize: 13, lineHeight: 20, includeFontPadding: true,
    color: color('#8a8a8a', 'muted'), paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
  list: { maxHeight: 250, flexGrow: 0 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 50, paddingHorizontal: 14,
    borderRadius: 16 },
  label: { fontSize: 16, lineHeight: 24, includeFontPadding: true, paddingVertical: 2,
    color: color('#161616', 'ink'), flexShrink: 1 },
  highlight: { backgroundColor: color('#f2f2f2', 'elevated') },
  message: { fontSize: 12, lineHeight: 18, color: color('#888', 'muted'), padding: 12, maxWidth: 400 },
}));
