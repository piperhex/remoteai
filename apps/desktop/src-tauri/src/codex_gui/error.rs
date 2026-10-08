#[derive(Debug, thiserror::Error)]
pub(super) enum GuiError {
    #[error("引用的对话暂时无法读取，请重新选择后发送；每条消息最多引用 8 个其他对话。")]
    ConversationReference,
    #[error("暂时无法读取对话的上下文设置，请重试。")]
    ContextSettings,
    #[error("视频暂时无法读取，请确认文件仍在当前项目中，且格式为 MP4、MOV 或 WebM。")]
    VideoPreview,
    #[error("文件超过当前传输大小上限。")]
    FileTooLarge,
    #[error("文件已更改，请重新打开。")]
    FileChanged,
    #[error("SOURCE_CHANGED")]
    FileSourceChanged,
    #[error("文件连接已过期，请重新打开。")]
    FileExpired,
    #[error("正在传输的文件较多，请稍后重试。")]
    FileBusy,
    #[error("文件暂时无法读取，请确认文件仍在当前项目中，且大小未超过查看上限。")]
    TextPreview,
    #[error("文件暂时无法下载，请确认文件仍在当前项目中。")]
    FileRead,
    #[error("文件暂时无法添加，请确认单个文件不超过 2 MB 后重试。")]
    Attachment,
    #[error("暂时无法读取当前项目文件，请确认项目仍可访问。")]
    ProjectFiles,
    #[error("暂时无法读取文件夹，请确认文件夹仍可访问。")]
    ProjectDirectories,
    #[error("图片暂时无法显示，请确认文件仍在当前任务目录中。")]
    ImagePreview,
    #[error("这条对话或其子对话仍有任务未完成，请等待结束并处理待发送消息后再删除。")]
    Busy,
    #[error("未能删除对话，请稍后重试。")]
    Delete,
    #[error("部分子对话的记录不完整，请先在会话管理中恢复后再删除。")]
    DeleteMissingHistory,
    #[error("关联子对话已变化，请刷新后重新删除。")]
    DeleteChanged,
    #[error("请先下载 Codex，即可开始对话。")]
    Executable,
    #[error("请选择有效的本地文件夹。")]
    Directory,
    #[error("暂时无法准备对话，请稍后重试。")]
    Workspace,
    #[error("对话请求无效，请刷新后重试。")]
    InvalidRequest,
    #[error("Codex 已断开连接，请重新连接后继续。")]
    Disconnected,
    #[error("Codex 响应超时，请检查连接状态。")]
    Timeout,
    #[error("Codex 未能完成操作，请检查当前账户、模型和 Codex 配置。")]
    Rpc,
    #[error("对话正在准备，请稍后重试。")]
    ThreadNotReady,
    #[error("Codex 暂时无法启动，请检查 Codex 配置后重试。")]
    Startup,
    #[error("暂时无法访问 GitHub，请检查网络后重试。")]
    Release,
    #[error("下载文件校验未通过，请重新下载。")]
    Integrity,
    #[error("Codex 安装未完成，请检查磁盘空间后重试。")]
    Install,
    #[error("所选文件无法读取，请重新选择下载好的文件。")]
    ImportFile,
    #[error("安装包无效或不适合当前电脑，请重新下载完整安装包。")]
    ImportPackage,
    #[error("版本校验文件无效，请从引导中的官方链接重新下载。")]
    ImportMetadata,
    #[error("安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。")]
    ImportMismatch,
    #[error("此版本已安装，或已有更新版本。请下载最新版本后再导入。")]
    ImportVersion,
}

impl GuiError {
    pub(super) fn from_rpc(error: &serde_json::Value) -> Self {
        let message = error["message"].as_str().unwrap_or_default();
        // A first turn can be acknowledged before the CLI flushes its rollout metadata.
        if message.starts_with("failed to read thread:")
            && message.contains("rollout at ")
            && message.ends_with(" is empty")
        {
            Self::ThreadNotReady
        } else {
            Self::Rpc
        }
    }
}

pub(super) type Result<T> = std::result::Result<T, GuiError>;
