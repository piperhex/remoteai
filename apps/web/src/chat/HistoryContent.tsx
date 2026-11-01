import { useContext, type ReactNode } from 'react';
import { ViewportContent } from '../../../../shared/chat/ViewportContent';
import { FileEnvironmentContext } from '../../../desktop/src/pages/codexGui/fileEnvironment';
import { MobileHistoryContent } from './MobileHistoryContent';

export function useHistoryWindowed(desktop: boolean) {
  // The desktop remote workspace embeds this list, including in narrow native windows.
  const environment = useContext(FileEnvironmentContext);
  return !desktop && !environment;
}

export function HistoryContent({ desktop, enabled, children }: {
  desktop: boolean; enabled: boolean; children: () => ReactNode;
}) {
  const windowed = useHistoryWindowed(desktop);
  return windowed ? <MobileHistoryContent>{children}</MobileHistoryContent>
    : <ViewportContent enabled={enabled}>{children}</ViewportContent>;
}
