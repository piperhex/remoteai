import { lazy, memo, Suspense, type ComponentProps } from 'react';
import { useWindowVisible } from '../../../../shared/token-usage/useWindowVisible';
import type { TokenUsageDashboard } from './TokenUsageDashboard';

const Dashboard = lazy(() => import('./TokenUsageDashboard').then(module => ({ default: module.TokenUsageDashboard })));

/** Keep preferences outside this boundary; hidden charts and their subscriptions are disposed together. */
export const TokenUsagePanel = memo(function TokenUsagePanel({ active = true, ...props }:
  ComponentProps<typeof TokenUsageDashboard> & { active?: boolean }) {
  const visible = useWindowVisible(active);
  if (!active || !visible) return null;
  return <Suspense fallback={null}><Dashboard {...props} /></Suspense>;
});
