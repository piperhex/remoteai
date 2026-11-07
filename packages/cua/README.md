# Remote AI CUA

Remote AI 的 CUA 子包独立构建并发布到
[`piperhex/remoteai` Releases](https://github.com/piperhex/remoteai/releases)。
发布标签为 `cua-v<版本>`，不占用 Remote AI 主程序的 Latest Release。

`package.json` 定义子包版本，`upstream.json` 固定上游提交、Rust 工具链及原始包 SHA-256。
`vendor/` 直接保存驱动及构建依赖源码，随 Remote AI 的普通 Git 提交和推送分发，无需初始化子模块。
包含上游 `libs/cua-driver`、`libs/cua`、`libs/images` 及许可文件，并已合入
`patches/windows-native-launch.patch` 中的兼容修复。CI 从此目录构建，不再克隆上游源码。
`source-lock.json` 记录入库文件的校验值，上游来源由 `upstream.json` 保留。
这是二进制发布子包，不发布到 npm，也不加入应用前端的构建依赖。

## Windows 兼容修复

部分关闭 UAC 的 Windows 主机上，SAFER 降权后仍保留启用的管理员组，
导致上游 0.37.0 拒绝启动应用。补丁在原有方式失败后，为原生应用创建独立的受限令牌：
禁用管理员组、移除管理权限、降低完整性级别，然后执行原有标准用户令牌校验。
失败时仍拒绝启动，不会使用管理员令牌兜底，也不会改变 CUA 自身或系统 UAC 设置。

补丁仅作用于原生应用 `launch_app`。隔离浏览器保留上游实现，因为受限令牌可能影响
Chromium 的沙箱。Windows 包重建 CLI 和 SDK DLL，其余辅助程序保留经过校验的上游版本。
重建的 CLI/DLL 不携带上游 Authenticode 签名；Remote AI 使用固定 SHA-256 校验下载内容。
macOS 通用包逐字节镜像上游归属宿主进程的运行时，保留原有签名。

## 构建和发布

需要 Node.js 20 及以上、Git、tar；Windows 还需要 Rust、Visual C++ Build Tools 和 Spectre 库。

```powershell
node packages/cua/scripts/test.mjs
node packages/cua/scripts/prepare.mjs
powershell -File packages/cua/scripts/install-spectre.ps1
node packages/cua/scripts/build.mjs windows-x86_64
```

`build.mjs` 也接受 `windows-arm64`、`darwin-universal`。
输出位于 `.codex-tmp/cua-release`，下载缓存位于 `.codex-tmp/cua-downloads`，不提交构建产物。
`prepare.mjs` 只校验仓库内源码，不下载、不改写源码；下载辅助运行时仍会验证固定哈希，
构建使用 `cargo --locked`。

修改源码后先检查差异，将新增文件加入 Git，再运行 `node packages/cua/scripts/prepare.mjs --record`，
将更新后的 `source-lock.json` 与源码一起提交。该清单用于发现漏提交、字节变化或构建目录混入。
升级上游时同时更新 `upstream.json`、源码和补丁记录，保留原始许可及第三方声明。

`node packages/cua/scripts/smoke.mjs <解压后的程序路径>` 验证标准权限模式下的 MCP 协议及工具发现。
Windows 设置 `CUA_NATIVE_LAUNCH_TEST=1` 后，还会分别通过直接启动和 Shell 启动字符映射表，
检查子进程令牌及窗口快照，最后清理测试创建的进程。CI 在两种 Windows 架构上执行这项测试。
本机关闭 UAC 时，上游两项隔离浏览器测试仍会因 SAFER 无法降权而失败；这不在本次原生应用补丁范围内。
上游 Clippy 现有告警保留，不通过全局禁用告警掩盖它们。

`.github/workflows/cua-release.yml` 在子包相关 PR 和 `master` 推送时执行构建验证，也支持手动构建。
确认版本及上游锁定信息、提交并推送后，推送相同版本的 `cua-v*` 标签触发发布。
也可手动运行工作流并勾选 `publish`：全部验证通过后才创建对应标签及 Release。
已有标签必须指向本次构建提交，已有 Release 不可覆盖。
所有平台成功后才发布，并附带 `manifest.json`、`SHA256SUMS` 和开源许可。
已发布的版本不可覆盖；发布源码或打包方式的变化时递增 `remoteai.N`。

发布完成后，将桌面端 `computer_use` 的版本及 SHA-256 更新为 Release 的实际值。
下载地址使用固定子包标签。已有启用的用户随 Remote AI 升级自动迁移到该版本；
用户主动停用或卸载的状态继续保留。不要查询仓库级 `releases/latest` 来选取 CUA 版本。

## 来源

上游：[trycua/cua](https://github.com/trycua/cua)，MIT 许可（见 `LICENSE.upstream`）。
上游应用降权实现：[PR #4282](https://github.com/trycua/cua/pull/4282)。
Remote AI 修改以本子包的提交和补丁记录为准，不代表上游官方发行版。
