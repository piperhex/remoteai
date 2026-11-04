# TCP 多路径与远程桌面 48 帧修复

## 连接路径

聊天、文件和远程控制消息现在可以同时尝试 WebRTC UDP 与原生 TCP。
TCP 使用同一个本地端口监听、向发现服务查询映射、向对端候选地址拨号，
包括 IPv4 公网/局域网地址和配置了 IPv6 发现服务时的 IPv6 地址。
原有加密 WebSocket 中转始终保留；这不是仅增加 STUN 域名。

双方必须在已鉴权信令上声明 `tcpPunch`，服务端也必须启用发现服务，才使用多路径封装。
缺少任一条件时继续使用原来的协议，因此 Web、iOS、旧桌面与旧手机不会收到不认识的封装。
重连沿用原有会话和 generation，旧代信令不能替换新连接。
目前 TCP 路径用于应用消息；视频仍走独立的原生 WebRTC 与既有 TURN UDP/TCP/TLS。

每条 TCP 连接用 X25519、双端随机挑战及 HMAC 验证对端，再用 HKDF 派生独立连接密钥，
以 ChaCha20-Poly1305 加密记录。双向序号和方向不同，同时建立多个套接字也不会复用 nonce。
应用层原有加密、确认和中转回退仍保留。TCP 发现服务只看连接来源地址，不承载应用数据。

每秒检查候选路径，优先使用有回应的 WebRTC，约三秒无回应后改用存活 TCP；
全部直连路径失效时继续由现有中转及重试策略接管。
每代最多六个候选地址、八个握手/数据通道，发现与监听十五秒后停止，
未鉴权握手五秒超时，套接字读写队列均有限制。
桌面 IPC 只允许主窗口使用由原生已鉴权信令授权的目标，拒绝任意主机/端口拨号。

Android 的 `SO_REUSEADDR` 实测无法共用活跃监听端口；系统 NIO 的 `SO_REUSEPORT`
在测试设备上也会报告不支持。因此为固定版本的 TCP 库增加仅对 `reusePort` 请求启用的
Android `Os` 套接字适配，绑定前设置 Linux `SO_REUSEPORT`，不使用隐藏 API。
普通 TCP、HTTP 媒体服务和 TLS 仍走库原来的实现。iOS 尚未接入这个平台适配。

部署参数见 [Go 部署说明](../apps/admin/DEPLOYMENT.md)。本次没有部署线上服务。
TCP simultaneous open 仍受 NAT 的映射方式和防火墙规则限制，不能保证穿透所有运营商网络。
本地/设备测试不能替代 Wi-Fi、5G、双重 NAT、IPv6 的跨网验收，尚无新增跨网成功率数据。

## 48 帧原因

Windows 原生 WGC 采集未设置 `GraphicsCaptureSession.MinUpdateInterval`。
在本机 144Hz 变化画面下，原路径稳定输出 48 FPS；仅修复输出节拍后仍为 48 FPS。
强制重复帧的诊断基线能输出 60 FPS，说明编码器吞吐足够。
原生采集改为按目标帧率的两倍请求更新，再由输出节拍限制实际发送率。
同时修复损伤门控按“上次实际提交时刻”重算间隔造成的刷新周期取整，改用固定截止时间，
跳过错过的时隙，不在暂停恢复后补发突发帧。

该配置对应 [Microsoft MinUpdateInterval API](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.minupdateinterval?view=winrt-26100)，
本项目 FFmpeg 兼容路径已经采取相同的超采样策略。具体 48 帧结论来自本机前后对照实测。

持续变化测试窗口每秒更新 144 次，目标 60 FPS，测量稳定的六秒区间：

| 路径 | 修复前 | 修复后 | 实际解码 |
| --- | --- | --- | --- |
| 原生 WGC + NVENC | 48 FPS | 60 FPS | 480 / 480 帧，8 秒 |
| GDI + 软件编码 | 波动，约 49–54 FPS | 一次测量约 56.7 FPS | 452 / 452 帧，8 秒 |

GDI 属于兼容路径，不能保证所有机器满帧。静止桌面仍按损伤检测减少发送，并每两秒保留恢复帧；
没有用重复画面填满帧率。回归用例还检查 120/144/165Hz 来源、微小更新、擦除恢复和空闲恢复。

完整原生采集 → WebRTC → Edge 播放测试在 1920×1080 下测得 59.99 FPS，五秒播放 300 帧，
候选类型为 `prflx`，并强制要求损伤采集后端，避免兼容路径掩盖问题。

## 可复验命令

```powershell
node scripts/test-desktop-frame-rate.mjs
node scripts/test-desktop-damage.mjs
$env:CSW_NATIVE_TEST_REQUIRE_DAMAGE='1'
$env:CSW_NATIVE_TEST_MOVING='1'
$env:CSW_NATIVE_TEST_MIN_FPS='55'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests native_capture_reaches_a_real_browser_decoder -- --ignored --nocapture
node apps/native/scripts/test-tcp-punch.cjs
node apps/native/scripts/test-tcp-punch-app.cjs
```

TCP 设备测试使用生产 Java 套接字，在 Android 模拟器及实体手机验证 IPv4/IPv6 监听端口复用、
两条出站连接、64 KiB 双向数据及关闭释放。它不修改应用数据。
TypeScript 的完整发现/加密连接测试使用真实本地 TCP、模拟端口映射；Windows Node 不支持
该监听端口复用，因此真实端口复用另外由 Rust 和 Android 设备测试验证。

独立 Android 测试 APK 还实际运行 Hermes、React Native 桥接、生产 TCP 适配和 `TcpPeer`，
在模拟器内完成发现、候选交换、密钥握手、22,000 字符加密传输及反向确认；结果通过。
此测试使用单独应用 ID，结束后卸载测试应用，并还原生成的 Gradle 文件及原 APK。
这仍然是设备本地测试，不代表已完成跨运营商打洞验收。

常规验证包括 Go 全套测试及 vet、Rust 格式/测试/严格 Clippy、桌面和原生单测、
桌面/Web 生产构建、Android 四 ABI release APK 构建、Web 九项横竖屏/桌面远程桌面用例。
