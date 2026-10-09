import { useProcessingStatus, type ChatProcessingProps }
  from "../../../../../shared/remote-chat/client/useProcessingStatus";
import { useGuiLanguage } from "../../i18n/useGuiLanguage";
import styles from "./styles.module.less";
import activeStyles from "./activeText.module.less";
import statusStyles from "./WorkingStatus.module.less";

export function WorkingStatus(props: ChatProcessingProps) {
  useGuiLanguage();
  const { phase, label } = useProcessingStatus(props);
  return <div className={styles.working} role="status" data-processing-phase={phase}>
    <span className={`${statusStyles.label} ${props.active ? activeStyles.text : ""}`}>{label}</span>
  </div>;
}
