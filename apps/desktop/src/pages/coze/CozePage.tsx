import { displayError } from '../../../../../shared/localization/uiText';
import { Alert, Button, Progress, Space } from "antd";
import { BookOpen, Bot, Download, GitBranch } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../shared/localization/useGuiLanguage";
import { useCoze } from "./useCoze";
import { CozeWorkspace } from "./CozeWorkspace";
import styles from "./CozePage.module.less";

export default function CozePage({ active }: { active: boolean }) {
  useGuiLanguage();
  const coze = useCoze(active);
  const status = coze.status;
  if (!isDesktopApp) return <div className={styles.welcome}>
    <h1>Coze</h1><p>{uiText("client.coze.openCozeInRemoteAiOnThisComputer")}</p>
  </div>;
  if (status?.url) return <CozeWorkspace url={status.url} busy={coze.busy} error={coze.error} onStop={coze.stop} />;
  const progress = status?.total ? Math.floor(status.downloaded / status.total * 100) : undefined;
  const phase = status?.phase === "verifying" ? uiText("client.coze.checkingTheDownload")
    : status?.phase === "installing" || status?.phase === "starting"
      ? uiText("client.coze.preparingCoze") : uiText("client.coze.downloadingCoze");
  return <div className={styles.welcome}><div className={styles.logo}>C</div><h1>Coze</h1>
    <h2>{uiText("client.coze.bringYourIdeasToLifeWithAi")}</h2>
    <p>{uiText("client.coze.createAgentsAndWorkflowsPoweredByYourKnowledgeBasesAnd")}</p>
    <Space className={styles.features} size={24}><span><Bot size={19} />{uiText("client.coze.agents")}</span>
      <span><GitBranch size={19} />{uiText("client.coze.workflows")}</span><span><BookOpen size={19} />{uiText("client.coze.knowledgeBases")}</span></Space>
    <p>{uiText("client.coze.downloadCozeToGetStartedThenUseItOnThis")}</p>
    {coze.error && <Alert type="error" message={displayError(coze.error)} />}
    {coze.busy && <div className={styles.progress}><Progress percent={progress} status="active" />
      <small>{phase}</small></div>}
    <Button type="primary" size="large" icon={<Download size={17} />} loading={coze.busy}
      disabled={!status} onClick={() => void (status?.installed ? coze.start() : coze.install())}>
      {status?.installed ? uiText("client.coze.openCoze") : uiText("client.coze.downloadAndGetStarted")}</Button>
  </div>;
}
