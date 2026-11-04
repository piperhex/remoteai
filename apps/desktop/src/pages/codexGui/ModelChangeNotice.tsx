import { uiText } from "../../../../../shared/localization/uiText";
import { Tooltip } from "antd";
import { Box, Info } from "lucide-react";
import type { Item } from "../../../../../shared/conversation/types";
import styles from "./ModelChangeNotice.module.less";

export function ModelChangeNotice({ item }: { item: Item }) {
  return <div className={styles.notice} role={item.success === false ? "alert" : "status"}
    data-history-anchor data-model-change>
    <span className={styles.line} />
    <div className={styles.label}><Box size={15} aria-hidden="true" /><span>{item.text}</span>
      <Tooltip title={item.summary?.[0]} styles={{ root: { maxWidth: 400 } }}>
        <button type="button" aria-label={uiText("client.conversation.aboutSwitchingModels")}><Info size={13} /></button>
      </Tooltip>
    </div>
    <span className={styles.line} />
  </div>;
}
