# Windows ChatGPT 更新与注入兼容性排查

排查日期：2026-10-10。反馈平台为 Windows，尚无反馈用户的客户端版本、错误码或更新日志。

## 已确认的行为

- 增强功能通过本机 CDP 连接加载页面脚本和样式，不修改 ChatGPT 的 `app.asar`、签名或安装目录权限。
- 启动参数为调试地址、调试端口和独立的 `cdp-profile` 目录，没有禁用更新的参数。
- Store 安装使用 `IApplicationActivationManager` 激活；启动前重新确认包身份，并跳过正在部署、
  维护或状态异常的包，不直接执行失去包身份的旧 `WindowsApps` 路径。
- 本机包版本为 `26.1002.7124.0`。只读检查其更新实现发现，Windows 更新依赖当前包身份；
  未发现上述三个参数直接关闭更新的判断。MSIX 备用更新器把暂存状态放在当前用户数据目录，
  因而普通启动和增强启动可能使用不同的更新暂存目录。
- 本机 10 月 9 日日志记录了 `enableUpdater=true`、更新策略 `enabled=true`，
  以及目标包 `26.1007.2314.0` 的下载成功事件。这证明这些本机会话的检查和下载可用，
  不能据此认定安装成功，也不能代替反馈用户的复现。
- 同一天也有一次更新检查错误 `net::ERR_NO_BUFFER_SPACE`。目前没有证据将它归因于注入。

微软文档说明 [Store 更新 API 需要包身份，安装更新可能使应用退出][store-updates]。
因此排查应区分检查、下载、安装和更新后启动，不能把任何阶段的失败都归因于页面注入。

## 已复现的自动恢复缺陷

旧会话保存 A 版本路径和 CDP 端口。更新启动 B 版本且没有旧 CDP 端口时，监控会观察到断线。
原逻辑仅要求两次进程检查都指向 B，持续 30 秒后允许终止并重启 B；
它没有要求 B 与旧会话记录的 A 是同一个安装。

回归用例直接调用生产恢复入口，用内存模拟进程和更新后的路径，确认旧实现会发起一次重启。
这属于已确认的更新交接干扰风险，尚不足以证明它就是反馈用户无法更新的根因。

修复后，断线计时和最终恢复入口都要求运行路径与受管理会话一致。
不同版本或缺少原安装路径时，不写入恢复状态、不停止进程，也不重新启动应用。
同一安装原有的一次自动恢复额度和 30 秒等待保留。
升级后若增强功能未连接，可通过现有连接入口按需重新连接或重启。

## 反馈用户的验证步骤

1. 记录 Remote AI 版本、ChatGPT 版本、更新入口和完整错误码，并确认失败发生在哪个阶段。
2. 保存工作后完全退出 Remote AI 和 ChatGPT，从开始菜单或 Microsoft Store 启动并更新 ChatGPT。
   仅隐藏窗口或暂停皮肤不足以排除代理模式的自动恢复。
3. 如果仍失败，检查对应时间的 `[windows-store-updater]`、`[windows-updater]`、`[sparkle]`
   日志，以及 Windows 的 AppX 部署事件；不要收集认证信息或完整会话数据。
4. 如果仅在 Remote AI 运行时失败，对照更新前后进程路径、CDP 断线时间和应用重启时间，
   判断是否命中自动恢复。下载成功后须再确认包版本实际变化。

本次使用模拟恢复测试，不关闭本机应用，不触发真实 Store 更新；macOS 不在本次实机验证范围内。

## 本地验证

- 回归用例在修复前失败：旧会话对新版发起了一次重启；修复后不再发起重启。
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` 通过。
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` 通过。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：1715 通过，15 个既有用例忽略，0 失败。
  覆盖更新路径切换、原会话路径缺失、Windows 路径等价、正常断线恢复，以及代理请求与轮询的并发。
- `node --test scripts/dream-skin-renderer.test.mjs scripts/dream-skin-bootstrap.test.mjs`：19 通过。
- `npm run build:desktop` 通过；仍有既有的前端分包体积提示。

本机默认链接遇到 `LNK1140`（PDB 大小限制）。在测试命令的进程环境中设置
`_LINK_=/DEBUG:NONE` 后，完整 Rust 测试通过。这只关闭本次链接的 PDB 输出，
未修改仓库构建配置或跳过测试，参见 [MSVC 调试信息选项][debug-info]。

[store-updates]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/package-updates-from-store
[debug-info]: https://learn.microsoft.com/en-us/cpp/build/reference/debug-generate-debug-info?view=msvc-170
