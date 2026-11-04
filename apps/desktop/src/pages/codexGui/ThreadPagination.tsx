import { uiText } from "../../../../../shared/localization/uiText";
import { LoaderCircle } from "lucide-react";
import styles from "./ThreadPagination.module.less";

export function ThreadPagination({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <div className={styles.footer} role="status" aria-live="polite">
    <span className={styles.hint}>
      <LoaderCircle size={13} strokeWidth={1.6} className={styles.spinner} aria-hidden="true" />
      <span>{uiText("client.workspaceActions.loadingMoreConversations")}</span>
    </span>
  </div>;
}
