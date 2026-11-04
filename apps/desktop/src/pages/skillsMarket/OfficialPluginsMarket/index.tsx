import { displayError } from '../../../../../../shared/localization/uiText';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodexHomeScope, CodexHomeSelect, useSelectedCodexHome } from "../../../components/CodexHomeScope";
import { useCliInstaller } from "../../codexGui/useCliInstaller";
import { CliInstallButton } from "./CliInstallButton";
import { LoaderCircle, Puzzle } from "lucide-react";
import {
  fetchOfficialPlugins,
  hasLocalBackend,
  installOfficialPlugin,
  removeOfficialPlugin,
  setOfficialPluginEnabled,
} from "../../../api/backend";
import { uiText } from "../../../../../../shared/localization/uiText";
import type { OfficialPluginItem } from "../../../types";
import { OfficialPluginGrid } from "../OfficialPluginGrid";
import { SkillsMarketToolbar } from "../SkillsMarketToolbar";
import type {
  OfficialPluginAction,
  OfficialPluginBusyAction,
  OfficialPluginsMarketProps,
} from "../types";

const ACTION_TOAST = {
  disable: "skills.official.toast.disabled",
  enable: "skills.official.toast.enabled",
  install: "skills.official.toast.installed",
  remove: "skills.official.toast.uninstalled",
} as const;

export function OfficialPluginsMarket(props: OfficialPluginsMarketProps) {
  if (props.homeId) return <OfficialPluginsContent key={props.homeId} {...props} homeId={props.homeId} />;
  return <CodexHomeScope active={props.active}><ScopedOfficialPlugins {...props} /></CodexHomeScope>;
}

function ScopedOfficialPlugins(props: OfficialPluginsMarketProps) {
  const homeId = useSelectedCodexHome();
  return <OfficialPluginsContent {...props} homeId={homeId} showHomeSelector />;
}

function OfficialPluginsContent({
  active,
  activeTab,
  notify,
  onTabChange,
  t,
  homeId,
  embedded,
  showHomeSelector = false,
}: OfficialPluginsMarketProps & { homeId: string; showHomeSelector?: boolean }) {
  const [items, setItems] = useState<OfficialPluginItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyAction, setBusyAction] = useState<OfficialPluginBusyAction | null>(null);
  const busy = useRef(false);
  const loadingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const plugins = await fetchOfficialPlugins(homeId);
      if (mounted.current) setItems(plugins);
    } catch (caught) {
      if (mounted.current) setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [homeId]);

  const installerCallbacks = useMemo(() => ({
    connect: load,
    clearError: () => setError(null),
    report: (caught: unknown) => setError(typeof caught === "string" ? caught : "操作未完成，请重试。"),
  }), [load]);
  const installer = useCliInstaller(active && hasLocalBackend, installerCallbacks);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, item.name, item.description, item.category, item.developer]
      .join("\n").toLocaleLowerCase().includes(needle));
  }, [items, query]);

  const runAction = async (plugin: OfficialPluginItem, action: OfficialPluginAction) => {
    if (busy.current || loadingRef.current) return;
    busy.current = true;
    setBusyAction({ pluginId: plugin.id, action });
    setError(null);
    try {
      if (action === "install") {
        await installOfficialPlugin(plugin.id, homeId);
      } else if (action === "remove") {
        await removeOfficialPlugin(plugin.id, homeId);
      } else {
        await setOfficialPluginEnabled(plugin.id, action === "enable", homeId);
      }
      if (!mounted.current) return;
      notify(t(ACTION_TOAST[action], { name: plugin.title }));
      await load();
    } catch (caught) {
      if (mounted.current) setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      busy.current = false;
      if (mounted.current) setBusyAction(null);
    }
  };

  let content = (
    <OfficialPluginGrid
      items={filtered}
      busyAction={busyAction}
      onAction={runAction}
      t={t}
    />
  );
  if (!hasLocalBackend) {
    content = <div className="skills-market-state"><Puzzle size={26} />{t("skills.official.localOnly")}</div>;
  } else if (!installer.checked || (loading && items.length === 0)) {
    content = (
      <div className="skills-market-state">
        <LoaderCircle className="spin" size={22} />{t("skills.official.loading")}
      </div>
    );
  } else if (!installer.version) {
    content = <div className="skills-market-state"><Puzzle size={26} />{uiText("client.desktopBuiltinPlugins.installCodexToBrowseOfficialPlugins")}</div>;
  } else if (filtered.length === 0) {
    content = <div className="skills-market-state"><Puzzle size={26} />{t("skills.official.empty")}</div>;
  }

  return (
    <div className="skills-market-page">
      <SkillsMarketToolbar
        embedded={embedded}
        active={active}
        activeTab={activeTab}
        loading={loading || busyAction !== null || !installer.version}
        onQueryChange={setQuery}
        onRefresh={() => void load()}
        onTabChange={onTabChange}
        query={query}
        t={t}
        beforeSearch={hasLocalBackend && <CliInstallButton installer={installer} />}
        homeSelector={showHomeSelector && <CodexHomeSelect disabled={busyAction !== null || installer.installing} />}
      />
      {error && <div className="skills-market-error" role="alert">{displayError(error)}</div>}
      {content}
    </div>
  );
}
