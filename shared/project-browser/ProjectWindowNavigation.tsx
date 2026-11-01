import { interpolate } from '@remoteai/i18n';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ProjectDocument } from './protocol';
import type { BrowserTranslate } from './ProjectTree';

export function ProjectWindowNavigation({ document, disabled, page, t }: {
  document: ProjectDocument; disabled: boolean; t: BrowserTranslate;
  page: (direction: 'previous' | 'next' | 'first' | 'last') => void;
}) {
  const window = document.window;
  if (!window) return null;
  return <div className="pf-window-navigation">
    <p className="pf-notice">{t('client.projectBrowser.windowMode')}</p>
    <div className="pf-editor-tools" role="toolbar" aria-label={t('client.projectBrowser.windowNavigation')}>
      <button type="button" disabled={disabled || window.offset === 0} onClick={() => page('first')}
        aria-label={t('client.projectBrowser.windowFirst')}><ChevronsLeft size={16} /></button>
      <button type="button" disabled={disabled || window.offset === 0} onClick={() => page('previous')}
        aria-label={t('client.projectBrowser.windowPrevious')}><ChevronLeft size={16} /></button>
      <span role="status">{interpolate(t('client.projectBrowser.windowRange'), {
        start: window.offset, end: window.end, total: document.size,
      })}</span>
      <button type="button" disabled={disabled || window.end >= document.size} onClick={() => page('next')}
        aria-label={t('client.projectBrowser.windowNext')}><ChevronRight size={16} /></button>
      <button type="button" disabled={disabled || window.end >= document.size} onClick={() => page('last')}
        aria-label={t('client.projectBrowser.windowLast')}><ChevronsRight size={16} /></button>
    </div>
  </div>;
}
