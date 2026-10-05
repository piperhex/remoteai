# Android 下载管理

设置中的“下载管理”统一管理聊天文件与视频的下载，也可以从当前聊天项目或“此电脑”的本地硬盘中选择文件。
下载管理使用独立页面，左上角返回按钮回到设置；浏览文件时，左上角按钮和 Android 返回键逐级返回文件夹及下载列表。
页面隐藏底部导航，以卡片展示文件入口、空状态和下载任务，区分下载中、暂停、失败与完成状态。
下载列表显示状态、大小、速度，提供暂停、继续、打开文件和删除操作。删除只影响手机上的下载文件与记录。

下载由 `apps/native/plugins/downloads` 中的 Android 工作线程调度。它负责分块校验、解码、写入、保存进度和发布文件；
React 只订阅状态，传输桥接沿用已有的加密聊天连接，最多同时下载两个文件。
Android 和 Web 下载管理使用滑动窗口：每块 256 KiB，默认每个文件同时传输 5 块。
前面的分块写入后立即补发新请求；乱序回复按偏移量暂存，待前面的分块齐全后按顺序写入。
在途请求和已收到但尚未写入的分块共同占用窗口，避免慢盘或乱序导致内存持续增长。
Admin「聊天设置 → 文件下载 → 同时传输分块数」可设置 1–12 块，对 P2P 和 Relay 均生效。
设置保存在既有 `chat_settings.policy` 中，经现有策略广播应用到在线客户端，无需数据库升级。
旧配置未包含 `fileDownloadWindowSize` 时默认使用 5。调小窗口时等待已发出的请求排空，不重启下载。
上限 12 为同时下载两个文件时保留聊天请求余量；Relay 仍检查原有文件大小和流量限制。

Android 每秒或每写入 4 MiB 保存一次进度，暂停、断线和完成时立即保存。
保存前先同步文件内容，再原子提交进度，避免每个分块都强制同步两次磁盘。
进程意外结束后从最近一次保存的位置继续，未保存的尾部会截断并重新下载。
关闭文件预览、离开下载页面或切换设置页面均不会取消任务。切到手机桌面时沿用聊天前台服务保持连接。
强制停止应用、切换电脑或失去连接时保留已写入进度，重新连接后可以手动继续；不承诺绕过系统强制停止继续运行。

未完成的文件和原子更新的任务记录位于应用私有目录，完成后保存到系统下载目录的 `Remote AI` 文件夹。
Android 10 及以上使用 MediaStore；Android 7–9 在首次下载时请求存储权限。
续传先重新打开源文件，检查大小和修改时间生成的版本标记；版本变化时从头下载，避免混合文件内容。
删除、暂停后的迟到响应会被丢弃，迟到的远程文件句柄会关闭。完成和未完成的文件均可删除。

电脑端新增 `downloadBrowse`、`downloadOpen` 请求，复用现有 `fileRead`、`fileClose` 分块接口。
项目模式保持项目目录边界；此电脑模式只允许已连接电脑的本地卷，拒绝 UNC、设备路径和相对路径。
目录遍历和文件操作均运行在 Rust 阻塞工作线程中。直连与中转下载继续使用既有大小限制。
手机和电脑都需要更新到支持这些请求的版本。iOS 保留已有的文件下载方式。

验证命令：

```powershell
npm run check -w @codex-switch/native
npm test -w @codex-switch/native
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

滑动窗口的 Android 引擎测试使用独立包 `com.codexswitch.mobile.downloadtest`，
覆盖动态窗口、乱序写入、进度保存、暂停续传、文件更新和完整文件哈希。
先通过 Expo prebuild 同步原生插件源码，再在 `apps/native/android` 构建测试包：

```powershell
./gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest -I ../e2e/downloads.init.gradle
adb -s emulator-5580 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5580 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5580 shell am instrument -w `
  -e class com.codexswitch.downloads.DownloadEngineTest `
  com.codexswitch.mobile.downloadtest.test/com.codexswitch.downloads.DownloadTestRunner
```

测试必须指定 `-e class`，避免平台测试运行器扫描整个 React Native 应用导致启动超时。
Web 下载回归使用 `apps/web/playwright.chat.config.ts` 下的 `downloads.pw.ts`，覆盖手机和桌面布局。
Admin 配置持久化和实时推送使用 Go 的 `scripts/chat-policy-smoke.mjs` 验证。

原生回归使用本地 `mobile-fixture.mjs` 和只读、可丢弃的 Android 模拟器。
它覆盖逐级返回、离开页面、暂停和重启续传、后台下载、SHA-256 完整性、硬盘浏览、删除、空文件、版本变化和损坏分块重试。

```powershell
# 在 apps/desktop 中先启动本地夹具
node e2e/mobile-fixture.mjs
# 另一个终端；仅用于只读、可丢弃的 emulator-5580
$env:ANDROID_CHAT_DISPOSABLE = '1'
$env:ANDROID_CHAT_OUTPUT = 'android-downloads-regression'
# 如使用独立构建产物，可设置 ANDROID_CHAT_APK 的绝对路径
node e2e/android-downloads-regression.mjs
```
