# 远程聊天与桌面可靠性

## 已实现

- 电脑的待发送队列保存在 `codex-gui-outbox.db`，使用 SQLite 完整同步事务和版本校验。
  发送和远程接收确认会等待保存完成。应用重新打开后恢复尚未发送的消息；上次正处于发送中的消息
  保留并提示核对，避免在结果不确定时自动重复执行。人工选择“发送全部”或“立即发送”可以重试。
  这不是对外部 app-server 的跨崩溃 exactly-once 承诺。
- Native/Web 共用桌面重连策略：短暂中断等待 8 秒；连接失败后按 1、2、4、8、15、15 秒重试。
  稳定连接 30 秒后重置退避。关闭、进入后台或切换电脑会清理恢复定时器；关闭信令最多等待 4 秒。
  电脑明确拒绝权限或不支持该平台时，不自动循环重试。
- 原生视频 helper 支持带版本标识的运行中控制。NVENC 更新公开的编码上下文参数；FFmpeg 的
  Media Foundation/OpenH264 wrapper 不提供相同的动态参数接口，因此仅重建 codec，保留采集器、
  GPU 资源和进程。旧 helper/FFmpeg 命令行后备仍用原有重启路径；分辨率变化仍需重建采集编码路径。
  自动模式从最高画质（宽度上限 2560）和 60 帧开始；手动帧率作为上限。拥塞时每次先降 10 帧，
  降至 30 帧后才降低自动画质的分辨率；手动画质保持所选分辨率。降帧同步按比例降低码率，
  尽量保留每帧清晰度。连续三次健康反馈后先恢复画质，再恢复 30 帧以上的帧率。
  原生发送端仅消费新的、未过期的网络反馈，避免短暂丢包被重复用于降档。
  PLI/FIR 请求触发关键帧，并限制触发频率。
- 剪贴板使用最多四个在途的 32 KiB 分块，按序确认，失败时等待已有分块结束后清理。
  新接收端在打开桌面时协商独立剪贴板 DataChannel；旧接收端继续使用原有控制通道。
  64 MiB/32 个文件上限保持不变，文件夹仍需压缩。尚未提供断线后的文件续传。
- 电脑设置提供桌面访问、键鼠、双向剪贴板、文件和声音的独立开关，权限在 Rust 侧执行。
  权限保存会撤销现有输入租约并关闭原生媒体流。只有本机主窗口能修改权限；手机/Web 显示仅观看状态。
- 每台电脑使用操作系统凭据存储中的 Ed25519 身份签署临时聊天公钥。
  新客户端首次记录签名身份后，会拒绝密钥替换和无签名降级。身份变化时，需要粘贴电脑设置中显示的
  完整指纹才能重新登记；不会以点击“重试”代替核验。手机使用 SecureStore，Web/桌面查看端使用本地存储。
  首次登记仍属于 TOFU，不代表首次连接已经独立于协调服务器完成线下身份核验。
  Go 服务需要更新以保留签名字段；已经登记身份的客户端连接到旧服务时会拒绝无签名降级。
- 回复完成、失败、等待审批和异步问题可触发手机通知。电脑发起推送的工作在 Rust 线程执行，
  不依赖主窗口是否处理该事件。Go 中继只接收事件类型和路由标识，不接收正文、标题、工具参数或文件内容。
- 远程聊天活动期间，Rust 检查主窗口心跳；连续 60 秒无响应时重新载入宿主界面。
  健康的空闲窗口不会重载。该措施提供故障恢复，不等同于完全独立于 WebView 的后台服务。

## iOS 推送配置

本次接入使用 Expo Push Service 转发 APNs。没有配置时不会请求推送令牌，现有本地通知仍可用。
当前仓库没有推送凭据，因此不能把编译或模拟测试视为 iOS 真机推送验收。

1. 在 Expo 创建项目，登记 Apple App ID，为该 iOS 应用配置 APNs 凭据。
2. 原生发布环境设置 `EXPO_PUBLIC_EAS_PROJECT_ID` 和 `IOS_BUNDLE_IDENTIFIER`；
   `apps/native/app.config.js` 会把它们写入应用配置。项目 ID 是公开标识，不是密钥。
3. 按 `apps/admin-go/DEPLOYMENT.md` 的数据库升级流程执行
   `apps/admin-go/sql/20260928-chat-push.sql`，再更新 Go 镜像。
4. Go 容器设置 `CHAT_PUSH_ENABLED=true`。启用 Expo 推送访问令牌保护时，将
   `EXPO_PUSH_ACCESS_TOKEN` 配置在服务器私有环境中，不放入原生 App、Web 包或仓库。
5. 重新构建并签名 iOS 安装包，在真机授权通知。应用会在登录及返回前台时更新订阅，
   切换账号/退出时尝试注销旧订阅；订阅最长保留 30 天。
6. 验证 App 前台、后台、系统挂起后的完成/失败/审批通知，以及点击后的账号、电脑和聊天定位。
   再验证退出登录、权限拒绝、令牌更新和 `DeviceNotRegistered` 的清理。

API 位于已认证的 `/chat-push/status`、`/chat-push/subscription` 和 `/chat-push/events`。
服务端使用持久化待发送记录、有限重试、发送回执查询和事件去重。推送提供商的成功回执只代表交付到
下游推送服务，不代表用户已经收到或读过。后台发送可能出现至少一次交付；客户端会对已处理的事件去重。

参考：[Expo 配置](https://docs.expo.dev/push-notifications/push-notifications-setup/)、
[发送与回执](https://docs.expo.dev/push-notifications/sending-notifications/)。

## 验证入口

```powershell
npm run check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests -- -D warnings
node scripts/test-desktop-adaptation.mjs
npm run test:remote-desktop:e2e -w @codex-switch/web
```

`test-desktop-adaptation.mjs` 在专用测试窗口中分别运行 GPU/GDI，验证同一发送进程内降码率、降帧率、
恢复与关键帧控制，使用真实 FFmpeg 解码器检查画面连续可解码。

原生 Windows → Edge 的可选测试支持长时间观察，每五秒检查连接和解码进展：

```powershell
$env:CSW_NATIVE_TEST_SECONDS = '600'
$env:CSW_NATIVE_TEST_MOVING = '1'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests native_capture_reaches_a_real_browser_decoder -- --ignored --nocapture
Remove-Item Env:CSW_NATIVE_TEST_SECONDS, Env:CSW_NATIVE_TEST_MOVING
```

LAN 长时间通过不能代替公网 TURN、丢包、限速、切网、休眠和移动真机验收。

## Windows 无人值守与当前限制

聊天的完整加密/会话处理仍依赖主 WebView；本次的持久化和 Rust 推送并未把全部聊天逻辑迁移为独立服务。
Windows x64 已加入可选系统服务、独立连接宿主、活动控制台 SYSTEM 媒体/输入工作进程、
本地受限 IPC 和安装卸载入口，继续使用现有手机/Web 界面。原生授权受手机认证有效期约束，
无人值守设备授权可从手机/Web 设备菜单撤销。具体启用步骤、权限边界、测试和限制见
[Windows 无人值守](windows-unattended.md)。系统服务尚需在可重启测试机上完成锁屏、UAC、
注销及重启前登录的实际验收；本次没有在用户电脑上安装服务或重启。
