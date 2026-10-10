import { Activity, Check, Image, Info, Monitor, Mouse, PanelsTopLeft, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { MAX_FPS } from '../../../../../shared/remote-desktop/protocol';
import { displayLabel, displayName } from '../../../../../shared/remote-desktop/displays';
import { FRAME_RATE_OPTIONS, MOUSE_INSTRUCTIONS, QUALITY_OPTIONS, type DisplaySettingsProps }
  from '../../../../../shared/remote-desktop/displaySettings';
import { useFrameRateInput } from '../../../../../shared/remote-desktop/useFrameRateInput';
import { t } from '../../i18n';
import './displaySettings.css';

function Section({ icon: Icon, title, description, children }: {
  icon: LucideIcon; title: string; description: string; children: ReactNode;
}) {
  return <section className="rd-display-section" aria-label={t(title)}>
    <div className="rd-display-section-heading"><Icon size={21} aria-hidden="true" />
      <div><h3>{t(title)}</h3><span className="rd-display-description">{t(description)}</span></div>
    </div>{children}
  </section>;
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="rd-display-hint"><Info size={15} aria-hidden="true" /><span>{children}</span></div>;
}

function Monitors({ displays, settings, saving, update, stats }: DisplaySettingsProps) {
  return <Section icon={Monitor} title="显示器" description="选择要使用的显示器">
    {displays.length > 0 && <div className="rd-monitor-grid" role="group" aria-label={t('显示器')}>
      {displays.map(item => <button key={item.id} className="rd-monitor-card" disabled={saving}
        aria-label={displayLabel(item, t)} aria-pressed={settings.displayId === item.id}
        onClick={() => { void update({ ...settings, displayId: item.id }); }}>
        <span className="rd-monitor-check" aria-hidden="true">
          {settings.displayId === item.id && <Check size={12} strokeWidth={3} />}</span>
        <span className="rd-monitor-preview" aria-hidden="true"><span /></span>
        <span className="rd-monitor-name">{displayName(item, t)}{item.primary && `（${t('主屏')}）`}</span>
        <span className="rd-monitor-resolution">{item.width} × {item.height}</span>
      </button>)}
    </div>}
    <button className="rd-stats-toggle" role="switch" aria-label={t('隐藏连接状态')}
      aria-checked={!stats.visible} onClick={stats.toggle}>
      <PanelsTopLeft size={20} aria-hidden="true" /><span className="rd-stats-toggle-copy">
        <span>{t('隐藏连接状态')}</span><span className="rd-display-description">{t('连接后不在屏幕上显示状态信息')}</span>
      </span><span className="rd-display-switch" aria-hidden="true"><span /></span>
    </button>
  </Section>;
}

function FrameRate(props: DisplaySettingsProps) {
  const { settings, saving, update } = props;
  const input = useFrameRateInput(props);
  return <Section icon={Activity} title="帧率" description="更高的帧率让画面更流畅，也会占用更多带宽">
    <div className="rd-display-options rd-frame-options" role="group" aria-label={t('帧率')}>
      {FRAME_RATE_OPTIONS.map(fps => <button key={fps} disabled={saving}
        aria-pressed={settings.fps === fps} onClick={() => { void update({ ...settings, fps }); }}>
        {fps === 'auto' ? t('自动') : `${fps} ${t('帧')}`}</button>)}
    </div>
    <form className="rd-frame-input" noValidate
      onSubmit={event => { event.preventDefault(); if (!saving) input.apply(); }}>
      <input type="number" min={1} max={MAX_FPS} step={1} value={input.custom}
        aria-label={t('自定义帧率')} aria-invalid={!!input.error} aria-describedby="rd-frame-feedback"
        onChange={event => input.edit(event.target.value)} />
      <span>{t('帧')}</span><button type="submit" disabled={saving} aria-label={t('应用帧率')}>{t('应用')}</button>
    </form>
    <div id="rd-frame-feedback">{input.error
      ? <div className="rd-display-error" role="alert">{t(input.error)}</div>
      : <Hint>{t('支持 1–144 帧。实际帧率取决于网络和电脑性能。')}</Hint>}</div>
  </Section>;
}

function Resolution({ resolution, settings, displays, saving }: DisplaySettingsProps) {
  const current = displays.find(display => display.id === settings.displayId);
  return <Section icon={Monitor} title="分辨率" description="调整远程电脑的桌面大小">
    {resolution?.options.length ? <div className="rd-display-options rd-resolution-options"
      role="group" aria-label={t('分辨率')}>
      {resolution.options.map(size => <button key={`${size.width}x${size.height}`} disabled={saving}
        aria-pressed={current?.width === size.width && current?.height === size.height}
        onClick={() => { void resolution.change(size); }}>{size.width} × {size.height}</button>)}
    </div> : <Hint>{t('这台电脑暂不支持切换分辨率。')}</Hint>}
  </Section>;
}

export function DisplaySettings(props: DisplaySettingsProps) {
  const { settings, saving, update, close } = props;
  return <aside className="rd-settings rd-display-settings" aria-label={t('显示设置')}>
    <header className="rd-display-header"><Monitor size={30} aria-hidden="true" />
      <div><h2>{t('显示')}</h2><span className="rd-display-description">{t('调整远程桌面的显示效果')}</span></div>
      <button className="rd-display-close" onClick={close} aria-label={t('关闭显示设置')}>
        <X size={22} aria-hidden="true" /></button>
    </header>
    <div className="rd-display-scroll" tabIndex={0} role="region" aria-label={t('显示设置选项')}>
      <Monitors {...props} />
      <Resolution {...props} />
      <FrameRate {...props} />
      <Section icon={Image} title="画质" description="在画质、流畅度和带宽之间取得平衡">
        <div className="rd-display-options" role="group" aria-label={t('画质')}>
          {QUALITY_OPTIONS.map(item => <button key={item.value} disabled={saving}
            aria-pressed={settings.quality === item.value}
            onClick={() => { void update({ ...settings, quality: item.value }); }}>{t(item.label)}</button>)}
        </div><Hint>{t('自动模式优先使用最高画质和 60 帧。网络不稳时先降帧，尽量保持清晰。')}</Hint>
      </Section>
      <Section icon={Mouse} title="鼠标操作" description="在远程桌面中使用鼠标的操作方式">
        <ul className="rd-mouse-instructions">{MOUSE_INSTRUCTIONS.map(text => <li key={text}>{t(text)}</li>)}</ul>
      </Section>
    </div>
  </aside>;
}
