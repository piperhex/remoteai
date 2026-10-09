import { Component, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MonitorOff } from 'lucide-react';
import { t } from '../../i18n';

interface Props { active: boolean; close: () => void; children: ReactNode }

/** Keep a viewer failure from unmounting the surrounding chat and application. */
export class DesktopErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  componentDidUpdate(previous: Props) {
    if (previous.active && !this.props.active && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.props.active) return null;
    return createPortal(<div className="rd-root rd-fallback" role="dialog" aria-modal="true"
      aria-label={t('远程桌面')}>
      <div className="rd-fallback-card">
        <MonitorOff size={36} aria-hidden="true" />
        <h2>{t('远程桌面暂时无法显示')}</h2>
        <p role="alert">{t('请重新连接，或关闭后再试。')}</p>
        <div className="rd-fallback-actions">
          <button type="button" onClick={() => this.setState({ failed: false })}>{t('重新连接')}</button>
          <button type="button" onClick={this.props.close}>{t('关闭')}</button>
        </div>
      </div>
    </div>, document.body);
  }
}
