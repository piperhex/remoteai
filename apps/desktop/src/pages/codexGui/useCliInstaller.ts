import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../../api/backend";
import { subscribeGuiEvent } from "./webEvents";
import type { GuiController } from "./controller";
import type { CliSnapshot } from "./cliManualDownloadApi";

interface Release { version: string; size: number; ready?: boolean }
interface Progress { downloaded: number; total: number; phase: "downloading" | "installing" }

export function useCliInstaller(active: boolean,
  controller: Pick<GuiController, "report" | "clearError" | "connect">, autoUpdate = false) {
  const [version, setVersion] = useState<string | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [checked, setChecked] = useState(false);
  const started = useRef(false);
  const busy = useRef(false);
  const checkingRef = useRef(false);
  const checkAgain = useRef(false);
  const mounted = useRef(true);
  const currentVersion = useRef<string | null>(null);
  const snapshotRevision = useRef(0);
  const releaseRevision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const prepare = useCallback(async () => {
    try {
      const prepared = await invoke<Release>("codex_gui_cli_prepare");
      if (mounted.current) {
        releaseRevision.current += 1;
        setRelease(value => value?.version === prepared.version ? prepared : value);
      }
    } catch {
      // Background failures stay quiet; the next scheduled check or manual update retries.
    }
  }, []);

  const checkVersion = useCallback(async (silent: boolean) => {
    if (checkingRef.current) { checkAgain.current = true; return; }
    checkingRef.current = true;
    setChecking(true);
    try {
      do {
        checkAgain.current = false;
        const revision = snapshotRevision.current;
        const next = await invoke<Release>(autoUpdate ? "codex_gui_cli_check" : "codex_gui_cli_release");
        if (!mounted.current) return;
        if (revision !== snapshotRevision.current) continue;
        releaseRevision.current += 1;
        setRelease(next);
        if (autoUpdate && next.size > 0 && next.version !== currentVersion.current && !next.ready) void prepare();
      } while (checkAgain.current);
    } catch (error) { if (!silent && mounted.current) controller.report(error); }
    finally { checkingRef.current = false; if (mounted.current) setChecking(false); }
  }, [autoUpdate, controller, prepare]);
  const check = useCallback(() => checkVersion(false), [checkVersion]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      const firstEntry = !started.current;
      try {
        const revision = snapshotRevision.current;
        const cachedRevision = releaseRevision.current;
        const installed = await invoke<CliSnapshot>("codex_gui_cli_status");
        if (!mounted.current || cancelled) return;
        started.current = true;
        if (revision === snapshotRevision.current) {
          currentVersion.current = installed.version;
          setVersion(installed.version);
        }
        if (cachedRevision === releaseRevision.current && installed.release !== undefined) {
          setRelease(installed.release);
        }
        setChecked(true);
        if (currentVersion.current && firstEntry) await controller.connect({ reuseExisting: true });
        else if (!currentVersion.current && !autoUpdate) await check();
      } catch (error) { if (mounted.current) { setChecked(true); controller.report(error); } }
    });
    return () => { cancelled = true; };
  }, [active, autoUpdate, check, controller]);

  useEffect(() => {
    if (!active || !autoUpdate) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void checkVersion(true); });
    return () => { cancelled = true; };
  }, [active, autoUpdate, checkVersion]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const subscription = subscribeGuiEvent<Progress>("codex-gui-download", setProgress);
    void subscription.then((stop) => { if (cancelled) stop(); }).catch(controller.report);
    return () => { cancelled = true; void subscription.then((stop) => stop()).catch(controller.report); };
  }, [active, controller]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const subscription = subscribeGuiEvent<CliSnapshot>("codex-gui-cli-state", snapshot => {
      if (cancelled) return;
      snapshotRevision.current += 1;
      releaseRevision.current += 1;
      currentVersion.current = snapshot.version;
      setVersion(snapshot.version);
      setRelease(snapshot.release);
    });
    void subscription.then(stop => { if (cancelled) stop(); }).catch(controller.report);
    return () => { cancelled = true; void subscription.then(stop => stop()).catch(controller.report); };
  }, [active, controller]);

  const install = async () => {
    if (!release || busy.current) return;
    busy.current = true;
    setInstalling(true);
    setProgress(null);
    controller.clearError();
    try {
      const installed = await invoke<{ version: string }>("codex_gui_cli_install", { version: release.version });
      if (!mounted.current) return;
      snapshotRevision.current += 1;
      releaseRevision.current += 1;
      currentVersion.current = installed.version;
      setVersion(installed.version);
      setRelease(value => value?.version === release.version
        ? { ...value, version: installed.version, ready: false } : value);
      await controller.connect();
    } catch (error) { if (mounted.current) controller.report(error); }
    finally { busy.current = false; if (mounted.current) setInstalling(false); }
  };
  const onImported = async (snapshot: CliSnapshot) => {
    snapshotRevision.current += 1;
    releaseRevision.current += 1;
    currentVersion.current = snapshot.version;
    setVersion(snapshot.version);
    setRelease(snapshot.release);
    controller.clearError();
    if (snapshot.version) await controller.connect({ reuseExisting: true });
  };
  return { version, release, checking, installing, progress, checked, check, install, onImported };
}
