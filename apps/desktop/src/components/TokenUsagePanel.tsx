import { lazy, memo, Suspense, type ComponentProps } from 'react';
import { useWindowVisible } from '../../../../shared/token-usage/useWindowVisible';
import type { TokenUsageDashboard } from './TokenUsageDashboard';
import { RetainedView } from '../../../../shared/RetainedView';

const Dashboard = lazy(() => import('./TokenUsageDashboard').then(module => ({ default: module.TokenUsageDashboard })));

/** Retain chart instances and selections; activity suspends their queries and drawing. */
export const TokenUsagePanel = memo(function TokenUsagePanel({ active = true, ...props }:
  ComponentProps<typeof TokenUsageDashboard> & { active?: boolean }) {
  const visible = useWindowVisible(active);
  return <div hidden={!visible} style={{ height: '100%', minHeight: 0 }}><RetainedView active={visible}>
    <Suspense fallback={null}><Dashboard {...props} /></Suspense>
  </RetainedView></div>;
});
