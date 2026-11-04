import { displayError } from '../../../../shared/localization/uiText';
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Empty, Select, Spin } from "antd";
import { loadAppSettings } from "../api/backend";
import { DEFAULT_CODEX_HOME_ID, GUI_CODEX_HOME_ID, type CodexHomeEntry } from "../types";
import { uiText } from "../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../shared/localization/useGuiLanguage";
import type { Language } from "../../../../shared/localization/language";
import styles from "./CodexHomeScope.module.less";

interface HomeScope {
  homeId: string;
  homes: CodexHomeEntry[];
  selectableHomes: CodexHomeEntry[];
  select: (id: string) => void;
}

const HomeContext = createContext<HomeScope | null>(null);

function useHomeScope() {
  const scope = useContext(HomeContext);
  if (!scope) throw new Error("Codex Home selection is unavailable");
  return scope;
}

export function useSelectedCodexHome() {
  return useHomeScope().homeId;
}

export function useCodexHomes() {
  return useHomeScope().homes;
}

export function CodexHomeScope({ active = true, excludedHomeIds = [], children }: {
  active?: boolean;
  excludedHomeIds?: readonly string[];
  children: ReactNode;
}) {
  const language = useGuiLanguage();
  const [homes, setHomes] = useState<CodexHomeEntry[]>([]);
  const [selected, select] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError("");
    void loadAppSettings().then((settings) => {
      if (cancelled) return;
      setHomes(settings.codexHomes ?? []);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setError("无法读取目录列表，请重试。");
    });
    return () => { cancelled = true; };
  }, [active, attempt]);
  // Exclude browsing sources without removing valid migration and restore destinations.
  const selectableHomes = homes.filter((entry) => !excludedHomeIds.includes(entry.id));
  const home = selectableHomes.find((entry) => entry.id === selected)
    ?? selectableHomes.find((entry) => entry.enabled) ?? selectableHomes[0];
  if (error) return <Alert className={styles.notice} type="error" message={displayError(error, language)}
    action={<Button size="small" onClick={() => retry((value) => value + 1)}>{uiText("client.terminal.retry", {}, language)}</Button>} />;
  if (!loaded) return <Spin className={styles.loading} />;
  if (!home) return <Empty description={uiText("client.desktopMisc.addACodexHomeInSettingsFirst", {}, language)} />;
  return <HomeContext.Provider key={`${home.id}:${home.path}`}
    value={{ homeId: home.id, homes, selectableHomes, select }}>
    {children}
  </HomeContext.Provider>;
}

export function CodexHomeSelect({ disabled = false, showLabel = true }: {
  disabled?: boolean;
  showLabel?: boolean;
}) {
  const { selectableHomes, homeId, select } = useHomeScope();
  const language = useGuiLanguage();
  return <label className={styles.selector}>
    {showLabel && <span>Codex Home</span>}
    <Select aria-label={uiText("client.desktopMisc.chooseTheCodexHomeToManage", {}, language)} value={homeId} onChange={select}
      disabled={disabled} popupClassName={styles.popup} popupMatchSelectWidth={false}
      options={selectableHomes.map((home) => ({ value: home.id, label: homeLabel(home, language) }))} />
  </label>;
}

/** Display name only; the path stays verbatim because it is user data. */
export function homeLabel(home: CodexHomeEntry, language?: Language) {
  if (home.id === GUI_CODEX_HOME_ID) return uiText("client.desktopMisc.builtInCodexGui", {}, language);
  if (home.id === DEFAULT_CODEX_HOME_ID) return uiText("client.desktopMisc.defaultFolder", { value1: home.path }, language);
  return home.path;
}
