import { gitVirtualizationChecks } from './git-virtualization-checks';

for (const mode of ['local', 'remote', 'web']) {
  gitVirtualizationChecks(mode, '/e2e/workspace-drawer-harness.html');
}
