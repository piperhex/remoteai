import { Alert } from "antd";
import { guiText } from "../../i18n/guiText";
import type { GuiState } from "./types";
import styles from "./styles.module.less";

export function GuiSetupAlerts({ computerUseSetup, unattendedSetup }:
  Pick<GuiState, "computerUseSetup" | "unattendedSetup">) {
  return <>
    {computerUseSetup === "installing" && <Alert className={styles.error} type="info" showIcon
      message={<span style={{ display: "block", maxWidth: 400 }}>
        {guiText("正在安装电脑助手，首次准备可能需要几分钟…")}</span>} />}
    {computerUseSetup === "failed" && <Alert className={styles.error} type="warning" showIcon closable
      message={<span style={{ display: "block", maxWidth: 400 }}>
        {guiText("电脑助手安装未完成。你可以继续对话，稍后到社区插件页安装或修复电脑助手。")}</span>} />}
    {unattendedSetup === "installing" && <Alert className={styles.error} type="info" showIcon
      message={<span style={{ display: "block", maxWidth: 400 }}>
        {guiText("正在启用无人值守，请在弹出的窗口中确认管理员权限。")}</span>} />}
    {unattendedSetup === "failed" && <Alert className={styles.error} type="warning" showIcon closable
      message={<span style={{ display: "block", maxWidth: 400 }}>
        {guiText("无人值守未能启用。你可以继续对话，稍后到远程设置中重试。")}</span>} />}
  </>;
}
