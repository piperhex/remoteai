# 远程命令插件

PC 端首次打开 Codex GUI 时会默认安装并启用“远程命令”，无需手动安装。
一次安装包含电脑发现、AI 命令调用和本机命令接收，无需分别安装客户端和服务端插件。
可在 **Codex GUI → 插件 → 社区插件** 中停用、卸载或重新安装；重启或重新连接不会恢复已停用或卸载的插件。
其他 Codex Home 仍可从社区插件页面手动安装。

两台电脑登录同一个 Remote AI 账号，并保持应用在线。目标电脑安装且未停用插件即可接收命令，
没有额外的“允许远程命令”开关。本机 AI 可在下一条消息中发现插件工具，例如：

> 检查我的办公室电脑的磁盘空间和占用较高的进程，分析卡顿原因。

AI 先调用 `remote_list_computers` 获取电脑名称、系统、在线和可用状态，再调用
`remote_execute`，使用确切的 `deviceId`。命令支持绝对工作目录、系统默认 shell、
1–60 秒超时（默认 30 秒），返回 stdout、stderr、退出码、超时标记、截断标记和耗时。
Windows 使用无窗口、非交互的 Windows PowerShell；macOS/Linux 使用 `/bin/sh`。
命令以桌面应用当前用户运行，不提升权限，不保留上次调用的 shell 状态。

默认允许同时执行 **5 条**远程命令。管理员可在 **后台 → 聊天设置 → 远程命令** 中
将并发上限设为 **1–32 的整数**。每个发起连接、每台目标电脑分别计数，任一达到上限时
新命令会收到繁忙提示。此设置与聊天连接上限相互独立；保存后对后续命令生效，
降低上限不会中断已经执行的命令。

插件停用或卸载后，该安装立即失去调用和接收权限，已有调用也会取消。不同 Codex Home
的安装相互独立；只要还有一个启用的安装，本机仍可接受同账号请求。
重新启用会更换本地凭据，旧的工具连接不能复活。命令执行期间断线、登出、超时也会取消执行；
已产生的修改不能撤销，连接失败后不应盲目重试会修改数据的命令。

## 实现边界

- 执行链路位于 `apps/desktop` 和 Go 后端 `apps/admin`，配置界面位于 `apps/admin-ui`；NestJS 保持冻结。
- 桌面插件安装器管理 MCP 配置、技能及每个 Home 的凭据，无需 Node/Python/SSH 或额外下载。
  仓库中的 manifest、技能和工具定义共同描述这个内置插件；运行时入口由安装器写入，
  不要把仅含资源的目录当成独立通用 MCP 服务安装。
- MCP STDIO 子进程通过仅监听 `127.0.0.1` 的本地服务调用桌面账号能力。
  每个调用都校验 Home 凭据与启停状态；浏览器 Origin 请求被拒绝。云端凭据不会进入 AI 工具结果。
- 复用 `/device-switch` 的账号认证与设备列表。Go 网关将命令绑定到同账号的目标电脑及其确切连接，
  仅向原请求方返回结果；其他账号、其他设备或被替换的连接不能提交结果。
- 使用现有 TLS WebSocket 通道传输命令与结果；这条控制链路没有聊天通道的端到端加密，
  协调服务会处理命令和输出，代码不持久化或记录其正文。
- 发起连接与目标电脑分别应用 `remoteCommandConcurrencyLimit`，默认 5、最大 32。
  策略存于现有 `chat_settings.policy`，缺少字段时使用默认值；Go 仅在启动及保存后刷新缓存，
  转发时附带 `concurrencyLimit`，不在全局控制锁内查询数据库。
  桌面以命令 ID 独立管理任务和结果；重连前的任务实际退出前仍占用进程名额。
  命令最多 16 KiB，每个输出流最多保留 64 KiB，超限继续排空管道。
  请求方断开会向目标发出取消；目标断开也会停止该连接所拥有的执行任务。
- MCP STDIO 与本地 HTTP 桥接各自最多处理 32 个并行调用，不为每条等待请求无限创建线程。
  STDIO 按 JSON-RPC ID 返回结果，整条 JSON 响应及换行由同一输出锁保护。
  每个工具调用仍独立建立云端请求连接；所有调用共享目标电脑的执行上限。
- 安装、检查、命令执行均在后台运行，插件状态轮询不重入，关闭页面会停止轮询。
- 默认安装在桌面 GUI 的独立 Home 中完成，早于对话服务启动，不依赖电脑助手安装成功。
  已有安装保留启停状态和凭据；自动安装失败后可在社区插件页面手动安装或修复。
  浏览器或手机连接不会触发主机的默认插件安装。

## 发布与验证

并发功能需要更新 admin-go、后台页面，以及发起端和目标端的 PC 应用；已运行的旧 MCP 工具进程也需重启。
旧版单命令客户端仍可连接，但其本地串行执行和桥接限制不会因后台配置而消失。
新版桌面连接未携带 `concurrencyLimit` 的旧服务端时默认使用 5，旧服务端仍执行自己的单条限制。
繁忙结果保留可读文案并附带错误代码，兼容旧客户端。无需新增数据库表或升级 SQL。

```powershell
npm run build:desktop
npx vitest run --root apps/desktop src/pages/skillsMarket/RemoteCommandCard src/pages/codexGui/GuiPluginsPage.test.tsx
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
go -C apps/admin test ./...
go -C apps/admin test ./internal/server -run TestKong
npm run generate:i18n
npm run check:i18n
```

设置 `REMOTE_COMMAND_TEST_DATABASE_URL` 为隔离 PostgreSQL 数据库后，`go test ./internal/devices`
还会验证后台事务、权限、策略刷新、重启加载及真实本地 WebSocket 的并发、结果路由和断连取消。
`remote_command::` Rust 测试使用本机临时目录中的受控命令验证 5/8 条实际重叠执行，
并通过本地协调服务替身验证 MCP STDIO → HTTP 桥接 → 真实 shell 的 8 条并发，不连接用户电脑。
后台截图回归：启动 `apps/admin-ui` 开发服务于 `127.0.0.1:1431` 后，运行
`node apps/admin-ui/e2e/remote-command-settings.mjs`；它使用 bundled Chromium 和本地 API 数据替身。

桌面本地对话、桌面远程对话和网页对话均调用运行对话的电脑上的同一 MCP 插件链路。
浏览器不在本地执行 shell，也没有独立的远程命令并发设置。跨设备实际验收仍需覆盖这些入口，
以及 Windows、macOS/Linux 的取消与进程清理；本地自动测试不能替代实机验收。

双机验收：安装 → 列出目标 → 获取系统信息与中文输出 → 非零退出 → 超时 → 执行中停用 →
重新启用 → 执行中断线 → 卸载；同时操作桌面和查看插件页面，确认界面仍可响应。
