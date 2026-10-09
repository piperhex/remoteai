import { ArrowLeft, ArrowRight } from "lucide-react";
import { guiText } from "../../../i18n/guiText";
import styles from "./preview.module.less";

export interface PreviewNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  back: () => void;
  forward: () => void;
}

export function PreviewNavigation({ navigation }: { navigation: PreviewNavigationState }) {
  return <div className={styles.navigation} aria-busy={navigation.loading}>
    <button type="button" aria-label={guiText("返回上一页")} title={guiText("返回上一页")}
      disabled={!navigation.canGoBack} onClick={navigation.back}><ArrowLeft size={18} aria-hidden="true" /></button>
    <button type="button" aria-label={guiText("前往下一页")} title={guiText("前往下一页")}
      disabled={!navigation.canGoForward} onClick={navigation.forward}><ArrowRight size={18} aria-hidden="true" /></button>
  </div>;
}
