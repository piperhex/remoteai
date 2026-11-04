import { useEffect, useRef, useState } from 'react';
import { hasLocalBackend, invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import type { CliSnapshot } from '../../../../../shared/conversation/cliManualDownloadApi';

export type HelpSetupPhase = 'checking' | 'downloading' | 'installing' | 'initializing';
export type HelpSetupError = 'installFailed' | 'initializeFailed' | 'previewOnly';
interface DownloadProgress { downloaded: number; total: number; phase: 'downloading' | 'installing' }

async function installCodex(reportPhase: (phase: HelpSetupPhase) => void) {
  const installed = await invoke<CliSnapshot>('codex_gui_cli_status');
  if (installed.version) return;
  const release = await invoke<{ version: string }>('codex_gui_cli_release');
  reportPhase('downloading');
  await invoke('codex_gui_cli_install', { version: release.version });
}

export function useHelpSetup(refresh: () => Promise<void>) {
  const [phase, setPhase] = useState<HelpSetupPhase>();
  const [error, setError] = useState<HelpSetupError>();
  const [progress, setProgress] = useState<number>();
  const currentPhase = useRef<HelpSetupPhase>();
  const busy = useRef(false);
  const mounted = useRef(true);
  const stop = useRef<() => void>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current?.(); stop.current = undefined; };
  }, []);

  const reportPhase = (value: HelpSetupPhase) => {
    currentPhase.current = value;
    if (mounted.current) setPhase(value);
  };
  const reportProgress = (value: DownloadProgress) => {
    if (!mounted.current || !['downloading', 'installing'].includes(currentPhase.current ?? '')) return;
    reportPhase(value.phase);
    const percent = value.total > 0 ? Math.floor(value.downloaded / value.total * 100) : undefined;
    setProgress(percent === undefined ? undefined : Math.min(100, Math.max(0, percent)));
  };

  const run = async (action: 'install' | 'initialize') => {
    if (busy.current) return;
    if (!hasLocalBackend) { setError('previewOnly'); return; }
    busy.current = true;
    setError(undefined); setProgress(undefined);
    reportPhase(action === 'install' ? 'checking' : 'initializing');
    try {
      if (action === 'install') {
        const unsubscribe = await subscribeGuiEvent<DownloadProgress>('codex-gui-download', reportProgress);
        if (!mounted.current) { unsubscribe(); return; }
        stop.current = unsubscribe;
        await installCodex(reportPhase);
      }
      if (!mounted.current) return;
      reportPhase('initializing');
      await invoke('codex_gui_connect', { reuseExisting: true });
    } catch {
      if (mounted.current) setError(currentPhase.current === 'initializing' ? 'initializeFailed' : 'installFailed');
    } finally {
      stop.current?.(); stop.current = undefined;
      if (mounted.current) await refresh();
      busy.current = false;
      if (mounted.current) setPhase(undefined);
    }
  };
  return { phase, error, progress, run };
}
