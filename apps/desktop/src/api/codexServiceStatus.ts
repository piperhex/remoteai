import { invoke } from './backend';
import type { ReadCodexServiceStatus } from '../../../../shared/codex-status/status';

export const readCodexServiceStatus: ReadCodexServiceStatus = () => invoke('get_codex_service_status');
