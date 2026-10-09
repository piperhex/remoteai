import { t, useLanguage } from '../../i18n';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MAX_FPS, type DesktopDisplay, type DesktopSettings } from '../../../../../shared/remote-desktop/protocol';
import { displayLabel } from '../../../../../shared/remote-desktop/displays';
import { desktopStyles as s } from './styles';

export function DisplaySettings({ settings, displays, update, saving, close, stats }: {
  displays: DesktopDisplay[];
  settings: DesktopSettings; update: (next: DesktopSettings) => Promise<void>; saving: boolean; close: () => void;
  stats: { visible: boolean; toggle: () => void };
}) {
  useLanguage();
  const [custom, setCustom] = useState(settings.fps === 'auto' ? '30' : String(settings.fps));
  const [error, setError] = useState('');
  const apply = () => {
    const fps = Number(custom);
    if (!Number.isInteger(fps) || fps < 1 || fps > MAX_FPS) { setError(t("请输入 1–{value1} 的整数。", { value1: MAX_FPS })); return; }
    setError(''); void update({ ...settings, fps });
  };
  return <View style={s.panel}>
    <View style={[s.row, { justifyContent: 'space-between', paddingBottom: 14 }]}><Text style={s.heading}>{t("显示")}</Text>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("关闭显示设置")}>
        <Text style={s.text}>{t("完成")}</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.panelContent} keyboardShouldPersistTaps="handled">
    {displays.length > 0 && <View style={{ gap: 8 }}><Text style={s.text}>{t("显示器")}</Text>
      {displays.map(item => <Pressable key={item.id} disabled={saving} accessibilityRole="radio"
        accessibilityLabel={displayLabel(item, t)}
        accessibilityState={{ checked: settings.displayId === item.id, disabled: saving }}
        style={[s.choice, settings.displayId === item.id && s.selected]}
        onPress={() => { void update({ ...settings, displayId: item.id }); }}>
        <Text style={s.text}>{displayLabel(item, t)}</Text></Pressable>)}
    </View>}
    <Pressable style={s.choice} accessibilityRole="switch" accessibilityLabel={t("连接状态")}
      accessibilityState={{ checked: stats.visible }} onPress={stats.toggle}>
      <Text style={s.text}>{stats.visible ? t("隐藏连接状态") : t("显示连接状态")}</Text></Pressable>
    <Text style={s.text}>{t("帧率")}</Text><View style={s.row}>
      {(['auto', 30, 60, 90, 144] as const).map(fps => <Pressable key={fps} disabled={saving}
        accessibilityRole="radio" accessibilityState={{ checked: settings.fps === fps }}
        style={[s.choice, settings.fps === fps && s.selected]} onPress={() => { void update({ ...settings, fps }); }}>
        <Text style={s.text}>{fps === 'auto' ? t("自动") : t("{value1} 帧", { value1: fps })}</Text></Pressable>)}
    </View>
    <View style={s.row}><TextInput disableFullscreenUI style={s.input} value={custom} onChangeText={setCustom}
      keyboardType="number-pad" maxLength={3} accessibilityLabel={t("自定义帧率")} />
      <Pressable style={s.choice} onPress={apply} disabled={saving}><Text style={s.text}>{t("应用帧率")}</Text></Pressable></View>
    <Text style={s.hint}>{t("支持 1–144 帧。实际帧率取决于网络和电脑性能。")}</Text>
    {!!error && <Text accessibilityRole="alert" style={s.text}>{error}</Text>}
    <Text style={s.text}>{t("画质")}</Text><View style={s.row}>
      {([{ value: 'auto', label: t("自动") }, { value: 'smooth', label: t("流畅") },
        { value: 'clear', label: t("高清") }, { value: 'original', label: t("超清") }] as const).map(item =>
        <Pressable key={item.value} disabled={saving} accessibilityRole="radio"
          accessibilityState={{ checked: settings.quality === item.value }}
          style={[s.choice, settings.quality === item.value && s.selected]}
          onPress={() => { void update({ ...settings, quality: item.value }); }}>
          <Text style={s.text}>{item.label}</Text></Pressable>)}
    </View><Text style={s.hint}>{t("自动模式优先使用最高画质和 60 帧。网络不稳时先降帧，尽量保持清晰。")}</Text>
    <Text style={s.text}>{t("鼠标操作")}</Text>
    <Text style={s.hint}>{t("在鼠标面板外，双指张合缩放画面，双指滑动平移画面。")}</Text>
    <Text style={s.hint}>
      {t("滑动画面或鼠标下半部移动指针，轻点单击。按住左键滑动即可拖拽，松手结束；长按不动可锁定拖拽，再点左键结束。按住中央箭头并拖动可滚动，松手返回鼠标面板。横线把手可移动鼠标面板。")}
    </Text>
  </ScrollView></View>;
}
