use crate::storage::{interface_language, InterfaceLanguage};

pub(super) fn busy() -> &'static str {
    match interface_language() {
        InterfaceLanguage::Zh => "远程命令数量已达上限，请等待正在执行的命令完成后重试。",
        InterfaceLanguage::En => "The remote command limit has been reached. Wait for running commands to finish, then try again.",
        InterfaceLanguage::Ru => "Достигнут лимит удалённых команд. Дождитесь завершения выполняемых команд и повторите попытку.",
        InterfaceLanguage::Ja => "リモートコマンド数が上限に達しました。実行中のコマンドが完了してから再試行してください。",
    }
}
