# Android 与 Web 下载管理

## 二进制文件协议

新版文件传输在管理端默认关闭（`fileBulkEnabled=0`）。需要桌面、接收端和当前传输路径同时
支持 `fileBulkV1` 才启用；Android 必须安装包含原生二进制桥接的新版 APK。
协议继续使用已有设备身份、文件授权与加密 RPC 获取清单和请求块；数据单独走有序可靠的
WebRTC DataChannel（negotiated ID 42）或 `CSF1` relay 二进制帧，不进入旧可靠投递窗口。
原生 TCP 直连没有可用的 RTC 二进制通道时使用兼容模式，iOS 保留已有下载方式。

PC 下载管理的中转接收端由 Rust 协商 `fileBulkV1`，校验 `CSF1` 记录所属会话后，
通过独立的原始二进制 IPC 通道送入已有 Web 下载校验与存储流程。每批最多 16 条记录，
上一批确认后才继续交付；每连接最多缓存 4 MiB，排队最多 256 条记录。
接收缓慢时暂停读取网络数据，同时继续处理确认、取消和连接状态，避免无限堆积或阻塞界面。
旧接收端未提供二进制回调时继续使用兼容模式，不向服务器声明该能力。

Rust 对已授权句柄预扫描生成 SHA-256 清单，发送每块前再次验证。清单通过认证控制面分页，
每页 256 个块哈希；规范 manifestId 覆盖大小、块大小、块数、有序块哈希和整文件哈希。
1 MiB 逻辑块最多 65,536 块（64 GiB）；超过当前协议上限安全报错，仍受原有直连/中转文件上限约束。
每个完整 record 包含 72 字节头和 16 字节 tag，上限 16 KiB，并按双方协商及 SCTP 上限缩小。
HKDF 为 transfer、清单、方向和 epoch 派生密钥，头部参与认证，序号单调且禁止回绕与重放。

接收端先预留完整块再发送 REQUEST。每 peer 共享 2 MiB 请求窗口，全局请求预算 16 MiB，
应用缓冲预算 32 MiB；固定块量子轮转文件，控制消息优先。Web 预留覆盖 assembly、Worker 转移、
密文队列和 Blob 提交；源端最多两个扫描/传输槽，读块受共享字节预算约束。
Android 最多两个活跃文件、每 peer 2 MiB assembly，原生收包队列额外限制为全应用 4 MiB。
DataChannel 发送高/低水位为 256/64 KiB，通过事件恢复；累计 CREDIT 不因重复消息增加。
REQUEST 附带单调编号，已完成的旧编号不能再次触发读取或计费。有效块哈希失败最多重试两次；
认证失败、越界或重放立即停止。30 秒无有效数据暂停该传输，沿用聊天连接的探测/恢复流程。

路径变化使旧 epoch 失效，迟到帧丢弃。重新连接后重新授权、重新生成 epoch，并逐块验证断点；
只有同一 manifest、临时文件身份和存储版本的块进入可信位图。源内容变化会清除旧版本断点并提示重新下载。
不会把 size/mtime 或旧协议偏移量直接当成可信块，也不把活跃文件宣称为某一时刻的原子快照。
需要一致性的数据库或日志应先由应用导出。

Android 先写临时文件，按 1 秒或 4 MiB 同步数据，再原子保存位图；最终哈希与 MediaStore 复制
使用独立有界保存线程。Web 在 Worker 解密/哈希，块与位图在同一 IndexedDB 事务提交，
按最多约 4 MiB 或 250 ms 组批。浏览器提交点不等于操作系统断电级 fsync。
存储缺失或坏块只重下对应块；磁盘/配额错误可见，不转成无限内存缓存。

状态区分准备、下载、校验和保存。Android 最终复制完成后才显示完成；保存失败保留临时文件，
可以离线再次保存。Web 下载完成先显示“文件已就绪”，导出前再次计算整文件哈希；
File System Access 输出只有 close 成功才显示完成。普通浏览器下载链接无法确认最终保存结果，
因此保持就绪并提示查看浏览器下载列表，不提前显示完成。
两端最多保存 500 条任务，临时文件保留供用户继续或删除；源端准备超时 15 分钟，空闲传输 5 分钟关闭句柄。

relay 每连接、账号、实例的 bulk 队列分别限制为 256 KiB、2 MiB、32 MiB，读入 bulk 时先检查
类型和上限再分配帧缓冲。配额及限速仍由 Go 后端检查；批量租约与协议开关独立，默认继续逐帧计费。
上线迁移、独立 `CHAT_BULK_LEASES_ENABLED` 开关、未知额度对账及回滚要求见
[Go 部署说明](../apps/admin-go/DEPLOYMENT.md)。

## 原有兼容模式

设置中的“下载管理”统一管理聊天文件与视频的下载，也可以从当前聊天项目或“此电脑”的本地硬盘中选择文件。
下载管理使用独立页面，左上角返回按钮回到设置；浏览文件时，左上角按钮和 Android 返回键逐级返回文件夹及下载列表。
页面隐藏底部导航，以卡片展示文件入口、空状态和下载任务，区分下载中、暂停、失败与完成状态。
下载列表显示状态、大小、速度，提供暂停、继续、打开文件和删除操作。删除只影响手机上的下载文件与记录。

下载由 `apps/native/plugins/downloads` 中的 Android 工作线程调度。它负责分块校验、解码、写入、保存进度和发布文件；
React 只订阅状态，传输桥接沿用已有的加密聊天连接，最多同时下载两个文件。
兼容模式使用滑动窗口：每块 256 KiB，默认每个文件同时传输 5 块。
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
兼容模式续传先重新打开源文件，检查大小和修改时间生成的版本标记；版本变化时从头下载。
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
  -e class com.codexswitch.downloads.DownloadEngineTest,com.codexswitch.downloads.BulkDownloadTest `
  com.codexswitch.mobile.downloadtest.test/com.codexswitch.downloads.DownloadTestRunner
```

测试必须指定 `-e class`，避免平台测试运行器扫描整个 React Native 应用导致启动超时。
Web 下载回归使用 `apps/web/playwright.chat.config.ts` 下的 `downloads.pw.ts`，覆盖手机和桌面布局。
Admin 配置持久化和实时推送使用 Go 的 `scripts/chat-policy-smoke.mjs` 验证。

### 持续传输与连接切换回归
电脑客户端作为下载接收端时，通过异步 `remote_native_bulk_receive` 读取原生 P2P 文件流，
每次最多返回 16 条原始二进制记录，同一连接只允许一个读取请求；空闲等待最多 250 ms。
数据经原生批次解码后进入共享下载器的 Worker 校验和 IndexedDB 写入，关闭连接后停止读取。
Android 继续使用原生文件写入器，Web 继续使用 WebRTC 文件通道。
桌面 `download-manager.pw.ts` 覆盖 32 MiB 原生 P2P 下载、暂停续传、页面切换和保存内容校验。


后台 direct 通道的创建、替换和关闭只影响被选中的 direct 路径，不能取消正在工作的 relay 下载。
真正切换路径仍终止旧 epoch，Android 和 Web 在连接可用时按 1、2、4 秒重试，重新协商并校验断点。
没有新增已验证进度时最多重试三次；手动暂停、断开连接、重启应用、完整性错误和保存失败不自动续传。

桌面每次最多通过一个 raw IPC 提交 16 个 record，Rust 校验整个批次的长度与会话后发送独立 CSF1 帧。
线上单帧仍最多 16 KiB；IPC 原始数据与解包副本共享 4 MiB 预算，取消等待不会提前释放队列预算。
发送完一个有界批次后让出执行机会，避免逐帧 IPC 确认和零延时定时器叠加 socket 空闲读取等待。

`bulkThroughput.test.ts` 覆盖 32 MiB 加密传输、顺序、哈希、批次上限和控制回调调度。
Android 原生测试和 Web 手机/桌面回归覆盖 32 MiB 文件校验、路径切换恢复及恢复期间手动暂停。
可单独运行真实本地 WebSocket 对照，比较逐帧确认与批量确认；它不作为公网性能承诺：

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib sustained_bulk_socket_throughput -- --ignored --nocapture
```

## 观测与灰度门槛

`downloadMetrics.ts` 提供最近 32 次本地传输/导出阶段统计及 512 个 RPC 耗时样本的 P50/P95/P99；
包含有效/线上字节、窗口等待、传输等待、预扫描、校验、存储和保存时间，不包含路径、密钥或内容。
Android 原生任务的 `measurements` 记录解密、块校验、写盘与最终保存耗时。
Go `BulkMeter.Measurements()` 提供批次数、记录数、线上字节与处理时间；账本行可核对成功及未知额度。
这些计数支持本地对比，不能替代网络栈 RSS、能耗、GC、Redis 调用追踪或端到端测速。

本地自动化覆盖协议长度、nonce/epoch、AEAD、credit、源文件同 size/mtime 修改、两文件共享窗口、
坏块恢复、路径切换、最终导出校验、Android 原生存储与系统保存，以及租约并发/重放/未知结果。
Web 自动化使用真实 Worker 和 IndexedDB、加密协议夹具；Android 使用原生 router/引擎夹具。
这些组件测试不等于实际桌面→手机的公网直连/中转完整链路验收。

启用生产开关前，还需要在目标手机和桌面上比较 v1.7.4 与新版的冷/热清单，使用同机同文件，
分别固定 RTT 20/100/200 ms、限速与丢包条件，每项至少五次保留原始数据。
统计总耗时（含预扫描、校验、保存）、有效吞吐、首字节等待、源端额外读盘、编码比例、
CPU/能耗、缓冲峰值、进程 RSS、bridge 拷贝、Redis 每 MiB 调用及 RPC 尾延迟。
另须完成接收/写盘/checkpoint/复制各阶段真实杀进程、慢盘/低内存/配额不足和计费进程故障注入。
完整性及配额用例必须全部通过，32 MiB 应用预算需压力验证，RPC P95 劣化不得超过 20%。
本轮未进行生产测速，不提供吞吐倍数或达标声明；协议与租约两个开关继续默认关闭。

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
