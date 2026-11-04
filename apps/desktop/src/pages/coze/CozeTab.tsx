import { lazy, Suspense, useEffect, useState } from "react";
import { uiText } from "../../../../../shared/localization/uiText";
import styles from "./CozePage.module.less";

const CozePage = lazy(() => import("./CozePage"));

export function CozeTab({ active }: { active: boolean }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  // Keep the editor mounted across main-menu navigation so drafts and the current view survive.
  return <section className={styles.panel} hidden={!active} aria-label="Coze">
    {(active || visited) && <Suspense fallback={<div className={styles.welcome} role="status">
      {uiText("client.projectBrowser.loading")}
    </div>}>
      <CozePage active={active} />
    </Suspense>}
  </section>;
}
