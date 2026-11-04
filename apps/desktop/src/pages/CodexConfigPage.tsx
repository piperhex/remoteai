import { uiText } from "../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../shared/localization/errors";
import { CodexHomeScope, CodexHomeSelect, useSelectedCodexHome } from "../components/CodexHomeScope";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Empty, Input, Segmented, Spin, Tag } from "antd";
import { CheckCircle2, CodeXml, RefreshCw, Search } from "lucide-react";
import { hasLocalBackend } from "../api/backend";
import { ConfigForm } from "./codexConfig/ConfigForm";
import { TomlEditorModal } from "./codexConfig/TomlEditorModal";
import { useCodexConfig } from "./codexConfig/useCodexConfig";
import { ConfigModelsContext, useConfigModels } from "./codexConfig/useConfigModels";
import styles from "./codexConfig/pageStyles.module.less";

export const CODEX_CONFIG_TOPBAR_ID = "codex-config-topbar-controls";

export function CodexConfigPage({ active, homeKey = "" }: { active: boolean; homeKey?: string }) {
  return <CodexHomeScope active={active}><CodexConfigContent active={active} key={homeKey} /></CodexHomeScope>;
}

function CodexConfigContent({ active }: { active: boolean }) {
  const homeId = useSelectedCodexHome();
  const config = useCodexConfig(active, homeId);
  const models = useConfigModels(active);
  const [editorOpen, setEditorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const document = config.document;
  const busy = config.pending > 0;
  useEffect(() => {
    setTopbarHost(active ? window.document.getElementById(CODEX_CONFIG_TOPBAR_ID) : null);
  }, [active]);
  if (!hasLocalBackend) return <Empty description={uiText("client.configEditor.openConfigurationInTheRemoteAiDesktopApp")} />;

  return (
    <div className={styles.page}>
      {active && topbarHost && createPortal(<div className={styles.controls}>
        <div className={styles.directory}>
          <span>{uiText("client.configEditor.configurationDirectory")}</span>
          <CodexHomeSelect disabled={busy || editorOpen} showLabel={false} />
        </div>
        <div className={styles.actions}>
          <span role="status" aria-live="polite">
            {busy ? <Tag icon={<Spin size="small" />}>{uiText("client.app.working")}</Tag> : null}
            {!busy && config.saved && !config.error && <Tag color="success"
              icon={<CheckCircle2 size={13} />}>{uiText("client.configEditor.savedAutomatically")}</Tag>}
          </span>
          <Button icon={<RefreshCw size={18} />} disabled={busy || editorOpen}
            onClick={() => { void config.reload(); void models.reload(); }}>{uiText("client.accounts.reload")}</Button>
          <Button type="primary" icon={<CodeXml size={18} />} disabled={!document || busy}
            onClick={() => setEditorOpen(true)}>{uiText("client.configEditor.editConfigToml")}</Button>
        </div>
      </div>, topbarHost)}
      <div className={styles.filters}>
        <Input allowClear prefix={<Search size={20} />} aria-label={uiText("client.configEditor.searchConfiguration")} placeholder={uiText("client.configEditor.searchSettingNamesOrKeywords")}
          value={search} onChange={(event) => setSearch(event.target.value)} />
        <Segmented value={filter} onChange={(next) => setFilter(String(next))} options={[
          { value: "all", label: uiText("client.configEditor.allSettings") }, { value: "configured", label: uiText("client.configEditor.configured") },
        ]} />
      </div>
      {config.error && <Alert type="error" showIcon message={document ? uiText("client.configEditor.configurationNotSavedYet") : uiText("client.configEditor.couldNotLoadConfiguration")}
        description={remoteErrorText(config.error)} className={styles.notice} />}
      {document?.error && <Alert type="warning" showIcon message={uiText("client.configEditor.checkTheConfigurationInTheEditorFirst")}
        description={remoteErrorText(document.error.message)} className={styles.notice} />}
      {models.error && <Alert type="warning" showIcon message={models.error} className={styles.notice} />}
      {!config.loaded && <div className={styles.loading}><Spin tip={uiText("client.configEditor.loadingConfiguration")}><div /></Spin></div>}
      <ConfigModelsContext.Provider value={models}>
        {document?.values && <ConfigForm key={config.reloadKey} values={document.values}
          disabled={editorOpen} onCommit={config.commit} view={{ search, filter, onSearchChange: setSearch }} />}
      </ConfigModelsContext.Provider>
      {document && <TomlEditorModal open={editorOpen} content={document.content} revision={document.revision}
        saveError={config.error} onSave={config.saveContent} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
