# Remote AI Native

React Native（Expo）移动端，用已登录的 Remote AI 云端账号查看官方账号与用量概览，并远程切换指定 PC 的官方模型或已同步第三方 Provider。

每次启动 App 都会检查更新，无需登录。有新版时可选择“忽略本版本”或“立即更新”。忽略记录保存在本机，
仅跳过该版本的启动提示；后续新版仍会提示，“关于”页也可随时手动检查。检查失败不会打断使用。
Android 沿用后台下载和安装流程，已有下载或待安装更新时不会重复提示下载；其他平台打开版本发布页。

底部“聊天”页可以连接同一账号下的 PC，继续 Remote AI 内置 GUI 的对话。WebRTC 直连与 admin 加密中转同时保持可用，
优先直连，故障时自动切换，恢复稳定后切回。配置、协议和验证方法见 [手机聊天说明](../../docs/mobile-chat.md)。
聊天需要原生 WebRTC 模块，请安装 APK 或使用开发构建，Expo Go 不支持此模块。

iPhone、iPad 和 Android 都可在聊天页打开“工具 → 远程桌面”，查看并操作已连接的 Windows 电脑。
支持鼠标／触屏模式、双指缩放、键盘输入、横竖屏切换和画质／帧率设置；iOS 横屏会避开底部手势区。
首次连接同一网络中的电脑时，请允许“本地网络”访问；远程桌面只接收电脑画面，无需麦克风或相机权限。
iOS 需要安装包含原生 WebRTC 的签名构建；浏览器也可使用 Web 端，操作入口相同。
本地可运行 `npm run export:ios -w @codex-switch/native` 检查 iOS bundle；完整 iOS 构建需在 macOS 上进行。

聊天会自动缓存已加载的记录和已查看的图片。保留登录状态时，即使断网或电脑离线，重启 App 后仍可
切换已缓存的对话、翻阅已加载的历史和查看已缓存的图片；连接恢复后同步电脑上的最新记录。
未加载的历史、未查看的原图、文件预览和视频仍需要连接电脑。离线时不能发送消息或处理审批。

缓存使用 `expo-sqlite` 的异步接口，按服务器、登录账号和电脑隔离，数据库不写入登录令牌。
每次先读最新一页，继续向上翻阅才读取更早的内容。生成回复期间合并保存任务，只写入变化的消息；
进入后台、切换聊天和停止连接时会刷新待保存内容。突然结束进程可能丢失尚未完成保存的最后一小段。
全局最多保留 20 个聊天，消息正文预算为 16 Mi 字符、每个聊天 2 Mi 字符，图片预算为 24 Mi 字符且最多
128 张（缩略图和原图分别计数）。达到限制时淘汰较旧的内容；缓存属于临时副本，不能代替备份。
本次新增 SQLite 原生模块，需要重新构建并安装 App。Android 离线回归入口为
`apps/desktop/e2e/android-offline-cache.mjs`，使用本地 mobile fixture 和标记为可清理的只读模拟器。

聊天输入框支持从相册选择照片或拍照，预览后可移除、单独发送或随文字发送。
每条消息最多添加 8 张照片；照片会缩放并转成 JPEG，再通过聊天连接发送给电脑。
相册使用系统照片选择器，只读取主动选择的照片；拍照时请求相机权限。
输入框加号提供“相机、手机照片、电脑照片、手机文件、电脑文件、插件”六个入口。
手机文件使用系统文件选择器，每个文件最多 2 MB，每条消息最多添加 8 个文件或插件。
电脑文件和电脑照片仅浏览当前聊天项目，照片入口会筛选图片；新聊天需要先选定项目。
插件面板展示所连接电脑实际可用的插件和技能，输入 `@` 可搜索并选择，选择时保留键盘。
电脑文件浏览、手机文件接收和完整插件列表需要配套更新桌面端；旧桌面端仍可提供技能列表。
图片预览支持双指缩放和拖动，轻点图片或使用系统返回即可关闭。手机转向后，点击左下角按钮可切换到当前方向；
右下角保存按钮将原图写入系统相册，Android 10 及以上无需读取相册权限，iOS 和旧 Android 按需请求保存权限。
新增的图片、方向感应和相册模块需要重新构建并安装 APK，单独更新 JS 不会生效。

聊天中的 MP4、M4V、MOV 和 WebM 文件链接可在应用内播放，具体编码支持取决于手机。
播放器支持暂停、拖动进度和横竖屏切换；视频通过现有加密连接按需读取，每块最多 256 KiB，
关闭预览或应用进入后台会释放播放连接。电脑只允许读取当前聊天项目内的视频。
管理后台“聊天设置 → 视频播放上限（MB）”默认 100 MB，可填写任意正整数，不设置业务上限；
已保存的旧设置会补入默认值，后续视频读取使用最新设置。
该功能需要配套更新桌面端与管理后台，并重新构建移动端安装包以注册 TCP socket 模块。
Android 视频回归入口为 `apps/desktop/e2e/android-video-preview.mjs`，使用现有本地 mobile fixture
和设置了 `ANDROID_CHAT_DISPOSABLE=1` 的只读模拟器；测试视频是仓库自制的 10 秒动画。

`expo-file-system` 必须保留为 native 工作区的直接依赖。仅由 `expo` 间接安装时，原生自动链接可能
漏掉它，导致相册和相机返回照片时出现 `AppDirectories not found`。`npm test -w @codex-switch/native`
会检查生成的 Android 模块注册列表，确认文件和图片服务均已注册。

## 启动

```bash
npm install
npm run start -w @codex-switch/native
npm run android -w @codex-switch/native
npm run ios -w @codex-switch/native
```

`npm run export:android -w @codex-switch/native` 可在不启动模拟器的情况下校验 Android JS bundle。

每个版本 tag 的 GitHub Release 会构建 `RemoteAI-android-v<版本>.apk`，以及未签名的
`RemoteAI-ios-unsigned.app.zip`。更新检索同时兼容旧版 `CodexSwitch-android-*.apk`。
Android 应用标识保持 `com.codexswitch.mobile`，确保已有安装可以正常升级。
iOS 压缩包用于 CI 构建验证；如需安装到真机或提交 App Store，仍需在 CI 中配置 Apple 证书与 provisioning profile 以导出签名 IPA。

本地交付 Android 安装包请在仓库根目录运行 `npm run build:apk`。该命令重新构建四种架构的原生依赖，
避免复用模拟器构建留下的 JNI 复制结果；Expo 的 `prebuild --clean` 本身不会清理依赖模块的构建输出。
本地构建和发布流程都会检查 APK 内各架构的原生库是否齐全，缺库时立即失败。
单独检查已有安装包可运行 `node apps/native/scripts/verify-apk.cjs <APK路径>`，需要 JDK。
模拟器启动验证不能代替 ARM64 安装包检查，交付前还应在 ARM64 设备上验证冷启动。

登录页默认使用官方服务器 `https://codex.onepiper.cloud`；如需连接自部署服务，可直接修改服务器地址，并随时通过“使用官方服务器”恢复默认值。Remote AI 登录令牌保存在 iOS Keychain / Android Keystore 支持的安全存储中。移动端会读取账户摘要、PC 设备列表和当前用户信息，并支持用户验证当前密码后修改密码。账户摘要会下发手机直连官方接口所需的短期 Codex access token，但不会下发 refresh token、ID token 或完整 `auth.json`；该 access token 只保存在应用运行时内存中。移动端通过 `subscribe-devices` 消息登录设备状态 WebSocket，随后接收 `devices-snapshot`、`device-online`、`device-offline` 和 `device-removed` 消息以实时更新 PC 在线状态。“设备”页会优先展示在线 PC，并允许删除已离线、不再使用的设备；选择在线 PC 后，可以通过同一服务端 WebSocket 通道切换该设备的官方模型或已同步第三方 Provider，不影响同一用户的其他设备。远程启用 Provider 前，需要先在目标 PC 启动本地代理。在官方模型与 Provider 之间切换后，移动端会提示立即或稍后重启目标 PC 上的 ChatGPT/Codex。

下拉刷新、页面内“刷新”和应用回到前台时，移动端会先从 Remote AI 后端读取账户列表和短期 access token，再由手机直接调用 Codex 官方接口刷新每个账号的用量。查看或使用重置卡也由手机直连 Codex，不经过 Remote AI 的重置卡代理接口。为避免瞬间发起过多请求，用量查询最多同时处理四个账号。access token 过期时，需要先由桌面端刷新账号凭据并完成云同步。隐私开关会遮罩账号卡片中的邮箱和备注预览；单击备注位置属于主动查看操作，会从底部抽屉展示完整备注。

账户页提供 2FA 验证码管理器，支持保存多个 TOTP 密钥、扫描标准 Authenticator 二维码、手动录入、编辑、
删除和复制动态验证码。密钥保存在 iOS Keychain / Android Keystore 支持的系统安全存储中。手机端的 2FA
云同步开关位于设置页，默认关闭；只有用户主动开启后，密钥才会上传到已登录的 Remote AI 云端服务器。

生产环境应使用 HTTPS。为了便于连接现有局域网或本地开发后端，当前 Expo 配置允许 HTTP；发布前若只使用 HTTPS，可移除 `app.json` 中的明文传输配置。
