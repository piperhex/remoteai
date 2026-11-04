import type { ReactNode } from "react";
import { uiText } from "../../../../../shared/localization/uiText";
import { ResizableThreadSidebar as SharedThreadSidebar } from "../../../../../shared/chat/ResizableThreadSidebar";
import styles from "../../../../../shared/conversation/styles.module.less";

export function ResizableThreadSidebar({ children, className = "", layoutSelector = `.${styles.page}` }: {
  children: ReactNode; className?: string; layoutSelector?: string;
}) {
  return <SharedThreadSidebar className={`${styles.sidebar} ${className}`} layoutSelector={layoutSelector}
    resizeLabel={uiText("client.chat.resizeChatList")}>
    {children}
  </SharedThreadSidebar>;
}
