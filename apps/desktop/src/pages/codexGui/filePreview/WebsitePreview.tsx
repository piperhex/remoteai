import { guiText } from "../../../i18n/guiText";
import { ExternalLink, RotateCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { message } from "antd";
import { CopyButton } from "../CopyButton";
import { useWebsitePreview } from "./useWebsitePreview";
import { PreviewNavigation, type PreviewNavigationState } from "./PreviewNavigation";
import styles from "./preview.module.less";

export function WebsitePreview(props: {
  url: string; active: boolean; resizing: boolean; navigation: PreviewNavigationState;
}) {
  const preview = useWebsitePreview(props);
  const openBrowser = () => {
    if (!preview.desktop) { window.open(props.url, "_blank", "noopener,noreferrer"); return; }
    void openUrl(props.url).catch(() => { void message.error({ content: guiText("链接暂时无法打开，请稍后重试。"),
      style: { maxWidth: 400, marginInline: "auto" } }); });
  };
  return <section className={styles.window} aria-label={guiText("网页预览")}>
    <header className={styles.toolbar}>
      <PreviewNavigation navigation={props.navigation} />
      <div className={styles.heading}><strong>{guiText("网页预览")}</strong><span>{props.url}</span></div>
      <CopyButton text={props.url} label={guiText("复制链接")} />
      <button type="button" className={styles.menu} aria-label={guiText("重新加载网页")} onClick={preview.retry}>
        <RotateCw size={16} /></button>
      <button type="button" className={styles.menu} aria-label={guiText("在浏览器中打开")} onClick={openBrowser}>
        <ExternalLink size={16} /></button>
    </header>
    <div className={styles.website} ref={preview.host}>
      {preview.failed && <div className={styles.feedback} role="status">
        {guiText("网页暂时无法显示，请重试或在浏览器中打开。")}<button type="button" onClick={preview.retry}>{guiText("重试")}</button>
      </div>}
      {!preview.desktop && !preview.failed && <iframe key={preview.attempt} title={guiText("网页预览")} src={props.url}
        sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" onError={preview.fail} />}
    </div>
  </section>;
}
