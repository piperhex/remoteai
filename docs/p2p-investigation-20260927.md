# P2P 连接调查与 Android Clash 真机验证

日期：2026-09-27。结论适用于本次设备和测试网络，不代表全量用户或跨运营商成功率。

## 已确认的原因

小米真机开启 Clash Meta 后，当前 Android WebRTC 把绑定到 Wi-Fi 的 UDP socket
公布成了 VPN 的地址。对端收不到正确的 Wi-Fi 候选，因此本来可用的局域网直连失败。
这不是仅靠开启 Clash「绕过私有网络」就能解决的问题：实测该开关原本已经开启。

在同一台手机、同一 WebRTC 版本、VPN 一直开启的独立探针中，只校正物理网卡候选地址，
数据通道就恢复双向传输。正式应用补丁也通过了手机到 Windows 虚拟机的聊天和远程桌面验证。

用户报告 UU 远程直连成功率高，随后明确 UU 连接的是宿主机或其他电脑。
因此不能把手机到 ZH2 的结果当成与 UU 的同条件对比。本次没有分析 UU 的闭源实现，
不能据此断言它采用了哪种打洞协议，或两者在相同端点上的成功率差距。

## 设备与控制条件

| 项目 | 条件 |
| --- | --- |
| Android | 小米 Civi 1S / 2109119BC，Android 14，USB ADB |
| 对端 | 已连接的 Windows 11 Hyper-V 虚拟机，应用设备名 ZH2 |
| 网络 | 手机、虚拟机、宿主机在同一 Wi-Fi/LAN 网段 |
| 原手机应用 | 1.6.2 |
| 修复应用 | 本仓库 1.6.5 release APK，保留登录数据覆盖安装 |
| 原生依赖 | react-native-webrtc 124.0.8；org.jitsi:webrtc 124.0.0 |
| Clash | 官方 ClashMetaForAndroid v2.11.34，arm64-v8a |
| VPN 配置 | 独立配置，所有流量 DIRECT，没有代理账号或订阅 |
| Clash 开关 | 绕过私有网络、允许应用绕过、DNS 劫持、系统代理开启；System Stack；IPv6 关闭 |

Clash APK 来自
[官方 release](https://github.com/MetaCubeX/ClashMetaForAndroid/releases/tag/v2.11.34)，
SHA-256：`1ce2f78d9258358c57b47dd538ee4a94aebd8d1e6afd05f67100d3cec1ca8a9c`。
本机初始没有安装 Clash，也未启用 VPN；安装及测试由用户明确授权。

## 实验结果

| 实验 | 结果与解释 |
| --- | --- |
| 原应用，VPN 关闭 | 可以连接 ZH2，显示 P2P |
| 原应用，VPN 开启 | 新建连接停留在中继；延长观察后连续 4 轮 ICE 协商均约 15.1 秒失败 |
| 原应用，同一会话关闭 VPN | 自动恢复 P2P，排除必须重启或重新登录的解释 |
| 独立探针，无 VPN | Wi-Fi host 候选正确，数据通道连接并完成 echo |
| 独立探针，VPN 开启 | Wi-Fi 与 VPN 两个 host 候选都公布 VPN 地址，连接失败 |
| 启用 requestVPN field trial | 仍失败，单纯增加 VPN 枚举不能修正地址 |
| 对端禁用 mDNS、公布字面 IP | 仍失败，问题不能仅归因于对端 mDNS |
| VPN 保持开启，探针校正地址 | 连接并完成 echo；精确 stats 版 connecting→connected 为 427 ms |
| 修复应用，VPN 开启 | 连续 3 次新建聊天连接均显示 ZH2 · P2P；首次批次约 80–81 ms 完成 connecting→connected |
| 修复应用，VPN 关闭 | 连续 3 次均显示 ZH2 · P2P |
| 修复应用，VPN 开启，远程桌面 | 显示直连，收到 1708×960 视频；截图/采样约 29–32 帧/秒；控制可以切换到 Windows 桌面并恢复 |

最终 APK 另外重做了 VPN 开启 3 次、关闭 3 次及远程桌面复验。
这里的毫秒数只计算 WebRTC 的 connecting→connected，**不是从点击到页面可用的总耗时**。
静止桌面的帧率会降低，单次帧率采样不是性能基准。

原应用前两次短观测只有 8 秒，不能当成完整 ICE 超时样本；失败周期来自第三次长观测。
原应用与修复 APK 的应用版本不同，因此另用同版本的独立原生探针隔离补丁变量。
探针使用 USB 仅交换信令，数据通道走 LAN UDP；浏览器只配置 host 候选，没有 TURN。
这避免了把中继转发误认作 P2P。

## 根因与补丁边界

上游 M124 的
[PhysicalSocket::Bind](https://github.com/jitsi/webrtc/blob/M124/rtc_base/physical_socket_server.cc)
先把 socket 绑定到 Android Network，再用 ANY 地址绑定端口。
[UDPPort::MaybeSetDefaultLocalAddress](https://github.com/jitsi/webrtc/blob/M124/p2p/base/stun_port.cc)
用默认网络地址替代 ANY；VPN 成为默认网络时，Wi-Fi socket 的 host 候选也可能得到 VPN 地址。

探针日志里同时存在 `wlan0 / Wifi` 和 `tun0 / VPN`，但两个候选的 IP 都是 VPN 的 `172.19.0.1`。
`getStats()` 仍能区分 Wi-Fi 候选（`networkType=wifi, vpn=false`）与实际 VPN 候选。
[JNI 转换](https://github.com/jitsi/webrtc/blob/M124/sdk/android/src/jni/pc/ice_candidate.cc)
对普通 onIceCandidate 传入 adapter type `0`，所以不能依赖 Java `candidate.adapterType` 来判断。

补丁位于 [native WebRTC helpers](../apps/native/patches/webrtc/README.md)：

1. 仅处理 UDP host IPv4，且原地址属于当前 VPN 接口。
2. 异步查询 stats，用地址、端口、优先级、协议和候选类型定位唯一候选。
3. 只校正非 VPN 的 Wi-Fi/Ethernet 候选，并要求对应物理网络只有一个可用 IPv4。
4. 保留真正 VPN、蜂窝、srflx、relay、TCP、IPv6、mDNS 以及元数据不足或有歧义的候选。
5. 回到 WebRTC executor 后发出事件；peer 已销毁时丢弃延迟回调。

没有把整个进程绑定到 Wi-Fi，没有调用 VPN protect，也没有改变系统路由或覆盖用户 VPN 策略。
修复的是发给对端的 trickle ICE 地址；原生 socket 和原始 local SDP 保持不变。
这不是任意 VPN 配置下强制直连的机制，严格禁止物理网络访问的策略仍会限制直连。

补丁在 postinstall 自动应用，锁定依赖版本，并在上游源码锚点变化时停止，要求重新审查。
聊天与远程桌面共用同一原生适配器，因此一起受益。
Web 使用浏览器自己的 WebRTC，没有 Android ConnectivityManager，也不能复制本修复；
共享信令和 UI 行为未更改，Web 已做对应构建和交互回归。iOS 不应用此 Android Java 补丁。

## 开源远程桌面和 IM 对照

| 项目 | 可核实的做法 | 对本项目的启示 |
| --- | --- | --- |
| [RustDesk 客户端](https://github.com/rustdesk/rustdesk/blob/master/src/client.rs) | 协商 NAT 信息，尝试多种传输路径，包括 TCP、UDP、IPv6，保留中继回退 | 原生打洞路径比浏览器 WebRTC 可控范围更大；不能假设只加 STUN 就能达到同样覆盖率 |
| [Jami LAN 文档](https://docs.jami.net/user/lan-only.html) | LAN peer discovery 可减少外部发现依赖；受限网络通过 TURN 回退 | 局域网发现、ICE 可达性和中继分别解决不同问题；发现设备不等于 socket 地址正确 |
| [Tox 协议](https://toktok.ltd/spec.html) | UDP 直连与 TCP relay 配合，维持多个 relay 以改善可用性 | 保持可用会话、后台争取直连；必须分开统计连接率和直连率 |

本项目 `shared/remote-chat/hotLink.ts` / `hotPeer.ts` 已有热中继、直连协商和重试，
并非完全缺少回退。此次记录证明反复重试同一个错误地址无效。

更广义的低成功率还有以下代码层面限制，但不能视作本次已实测的公网故障：

- `apps/admin/internal/devices/stun.go` 的 `CHAT_STUN_URLS` 默认空；内置 STUN 监听与
  向客户端下发可达公网 URL 是两个配置项。未正确下发时，跨 NAT 难以得到可用公网映射。
- 内置 STUN 是 IPv4 UDP。跨运营商、对称 NAT、双层 NAT 或 UDP 受限时，仍需分别测试。
- 聊天数据直连使用 WebRTC，回退是应用已有的加密 WebSocket 中继；聊天 STUN 配置不是 TURN 配置。
  视频另有 TURN UDP/TCP/TLS 能力。TURN 能改善连接可用性，但应归类为中继。
- 当前日志更擅长记录状态变化，后续应记录脱敏的候选类型、选中路径、失败阶段和耗时，
  用真实样本判断瓶颈，再决定是否增加原生 TCP/UDP 打洞或公网发现服务。

首轮局域网调查没有测量生产 STUN 的公网可达性，也没有跨运营商和双对称 NAT 对照。
手机移动数据当时关闭，未改变其移动数据设置。随后用户开启移动网络，补测结果见文末。
不能用同一 LAN 的结果声称公网成功率已全面解决。

## 复现与验证

测试配置（nameserver 使用测试 Wi-Fi 的路由器地址）：

```yaml
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxies:
  - name: TEST-DIRECT
    type: direct
dns:
  enable: true
  enhanced-mode: redir-host
  nameserver: [192.168.5.1]
rules:
  - MATCH,DIRECT
```

1. 手机与 Windows 对端接入同一 LAN，确认应用能完成设备配对。
2. 记录 VPN 关闭时的状态，开启上述 Clash 配置并保留默认网络开关。
3. 新建应用连接，观察至少 30 秒；记录 connecting/connected/failed 与 P2P/中继标记。
4. 安装带补丁的 APK，重复 VPN 开/关各 3 次；打开远程桌面检查视频、直连标记和控制反馈。
5. 用相同 WebRTC artifact 的独立探针对照原始与校正后的候选，要求实际 echo 成功。

已完成的自动验证：

- 原生 TypeScript 检查；最终原有及补丁测试合计 554 项通过。
- 独立 JVM 测试覆盖候选匹配、VPN 保留、歧义、缺失信息、IPv6、非 host、TCP 及无效输入。
- 共享聊天 RTC / hotPeer / hotLink：25 项通过。
- Android release 构建；APK 四种 ABI 的原生库检查通过。
- Web TypeScript 和 Vite 生产构建通过；远程桌面浏览器测试 9 项通过（横屏、竖屏、桌面）。
- Desktop TypeScript 和 Vite 生产构建通过。

构建有已有的大 bundle / Gradle 弃用提示，没有构建或测试失败遗留。
原始设备日志、含用户桌面的截图、测试 APK 和临时探针保留在本地 `.codex-tmp/p2p-investigation/`，
不提交到仓库。修复 APK 位于 `apps/native/android/app/build/outputs/apk/release/app-release.apk`。
测试结束后恢复 VPN 关闭，保留官方 Clash 及独立 DIRECT 配置供复验；移除独立探针和测试端口转发。

## 16:14 起补测：5G 手机连接 ZH2

用户将同一真机切到移动网络后，重新测试 1.6.5 修复 APK。
Android ConnectivityManager 确认默认网络为 `MOBILE[NR] / CELLULAR / VALIDATED`，
接口为 `rmnet_data2`；没有 Wi-Fi IPv4，基线没有 VPN 接口。
蜂窝接口同时具有私网 IPv4 和全局 IPv6；不能只用双卡设备的全局 `mobile_data` 开关值判断当前网络。

**结果：此次移动网络到 ZH2 的公网直连仍失败，中继可用。** 这与上面的局域网修复结论分别成立。

| 测试 | 结果 |
| --- | --- |
| VPN 关闭，正式修复 APK，3 次独立聊天连接 | 0/3 P2P，均为 `ZH2 · Relay`；观测窗口分别为 30、30、45 秒 |
| VPN 关闭，正式修复 APK，远程桌面 | 可出图，1708×960，采样 16 帧/秒，明确显示「中继」 |
| Clash 开启，正式修复 APK，3 次独立聊天连接 | 0/3 P2P，均为 `ZH2 · Relay`；每次观测 30 秒 |
| Clash 开启，正式修复 APK，远程桌面 | 可出图，1708×960，采样 24 帧/秒，明确显示「中继」 |
| VPN 关闭，仅增加日志的诊断 APK | 公网 IPv4 候选存在；重复协商超时并回退中继 |
| Clash 开启，仅增加日志的诊断 APK | 双方仍有公网 IPv4 候选，连接仍回退中继 |

正式无 VPN 聊天样本为本地记录 `cellular-no-vpn-1`、`cellular-no-vpn-2` 和
`cellular-no-vpn-confirm-1`；与远程桌面观测重叠的一轮不计入独立聊天统计。
Clash 使用原来的独立全 DIRECT 配置；为适配移动网络，将其中仅在 LAN 可达的路由器 DNS
换成当前蜂窝网络下发的 DNS，配置下载成功后再启用 VPN，避免混入 DNS 不可达的干扰。

### 此次新增的实际候选证据

临时诊断 APK 只增加原生连接日志，没有修改 ICE 配置、候选修复、超时或回退逻辑。
它记录了真实应用和真实 ZH2 对端的信令，未使用另一个测试对端代替虚拟机：

- 聊天配置实际包含 1 组 STUN，手机本地和 ZH2 发来的远端候选均有 UDP `srflx` 公网 IPv4。
  因此本次不能归因于 STUN 未配置或完全不可达。
- 无 VPN 时，手机还有 UDP host 全局 IPv6；此次 ZH2 只发来 mDNS host 与 IPv4 srflx，
  没有收到可配对的远端 IPv6 候选。
- 一段无 VPN 诊断日志中，手机发出 622 个 ICE peer binding 请求，收到的 peer binding
  请求和响应均为 0；完整的两轮检查分别在约 15 秒后记录 `Timed out ... without a response`。
  这里统计的是对端连通性检测，不是向 STUN 服务获取映射地址的请求。
- mDNS host 解析失败也出现在日志里，但同一次协商仍有公网 IPv4 候选并向它发起了检测，
  不能把公网失败仅归因于 mDNS。

可确定失败阶段是公网候选之间的连通性检查。手机侧日志不足以区分运营商 NAT 映射、
过滤行为、对端 NAT 或防火墙中的具体责任点；不同 socket 的公网端口变化也不能证明对称 NAT。
后续若继续定位，应在同一 UDP socket 上测量多目的地址的映射，并取得 ZH2 侧对应的收发记录。
本次没有修改生产 STUN、TURN、路由器、防火墙或运营商网络设置。

诊断原始日志仅在 `.codex-tmp/p2p-investigation/cellular-*.log`，不提交个人网络地址与候选详情。
诊断后已覆盖安装原修复 APK，并确认本地 release APK 与原包 SHA-256 一致；依赖源码中的临时日志已恢复。
测试结束关闭 Clash 和远程桌面，移除临时配置服务及 ADB 转发，保留用户当前的移动网络连接。

## 18:06 起严格补测：双端证据、宿主机和映射对照

这批实验针对用户补充的「UU 连接宿主机或其他电脑」。手机仍是同一台小米真机，
但蜂窝接口已变成 `rmnet_data3`，因此单独列出，不和 16:14 的样本合并计算成功率。
全程 Wi-Fi 关闭、没有 VPN 接口；没有修改路由器、系统 DNS、代理或防火墙配置。

### 样本有效性

中断前 `rigorous-vm` 一轮出现 ADB 断连、PID 缺失及旧 UI 数据，**完全作废**。
临时脚本现检查每条 ADB 命令的退出码、应用 PID 在采样前后是否一致、UI 是否新鲜且确在 ZH2 聊天页，
并在 `finally` 中停止抓包。重新采样的 `rigorous-vm-valid` 应用日志有效，但 ETL 没有包内容，
所以没有用它判断网络收发。

PktMon 记录缓冲占用为 768 MB；将原 16 MB 循环文件上限提高到 1024 MB 并显式记录原始包后，
`rigorous-vm-packets` 获得 1056 条包记录，ETL 报告无事件丢失。
该数字含虚拟交换机与物理网卡的重复观测，不能直接当成独立报文数。

### 真实应用到 ZH2：候选与包逐轮对应

在主机上同时观测 ZH2 外部虚拟网卡与物理网卡，过滤 ZH2 的 IPv4 UDP。
手机使用仅增加日志的诊断 APK。18:09:38–18:10:24 的一次新建聊天连接中，
出现三次 ICE 协商，其中前两次完整超时，第三次仍在观测窗口内；不能把三次协商当成三次独立连接。

| 检查 | 实际证据 |
| --- | --- |
| STUN 获取映射 | ZH2 收到成功响应，响应里的公网 IP/端口与手机收到的远端 srflx 候选一致 |
| ZH2 发包 | 仅统计虚拟网卡组件 264，三轮分别向手机当轮公网候选发出 79、80、71 个检测包 |
| 物理出口 | 同方向检测包也出现在物理网卡组件 266，排除仅停留在虚拟交换机内的解释 |
| ZH2 收包 | 未观测到来自手机当轮公网候选地址/端口的返回 UDP；整个捕获内也未见其他 peer ICE 返回包 |
| 手机检测 | `connection.cc` 记录 837 次 peer Binding 请求，peer 请求和响应接收日志均为 0 |
| 完整超时 | 15034 ms、15040 ms；最后一轮未计作完整超时 |
| 应用表现 | 新建连接最终仍显示 `ZH2 · Relay` |

手机日志证明 WebRTC 调用了发送，电脑抓包证明电脑侧报文已到物理出口；没有手机公网出口抓包，
所以仍不能精确指定中间哪台 NAT/防火墙丢包。这里不能把 STUN 服务器回包误算成 peer 回包。

### 同一个 UDP socket 的多目标映射

手机上的独立 Java 探针使用一个未连接的 `DatagramSocket`，按 A→B→A→C→A 顺序发送
STUN Binding Request，核对响应来源、事务 ID 和映射属性。A 为生产 `onepiper.cloud:3478`，
B 为 [Cloudflare 公共 STUN](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/)，
C 为 `stun.l.google.com:19302`。每轮保持同一个本地端口，三轮分别创建三个 socket。
域名在手机上解析后固定目标 IPv4；宿主机探针对照使用这些相同目标。

- 手机三轮都得到 **A、B、C 三组不同的公网 IP 和端口**；每轮重新访问 A 均恢复为原 A 映射。
  全部目标最终响应，没有把超时当作 NAT 类型判据。
- 这是本次网络路径存在「映射随目标变化」的直接证据；不是通过比较不同本地端口猜测 NAT。
  它解释了为什么 STUN 公网候选存在，却不保证该候选适用于与电脑通信。
- 宿主机三轮也出现目标不同、映射不同，并且访问部分目标时出口公网 IP 不同。
  这包含网络分流/代理的影响，不能全部归因于普通 NAT，更不能直接归因于手机运营商。
- 附加尝试的服务器 3479 端口返回私网映射，已从上述判断中排除；实际聊天 ICE 仅配置 3478。

这些是有限时间、有限目的地址的观测，不是完整 RFC 5780 映射/过滤分类。
尤其没有具备 `OTHER-ADDRESS`、`CHANGE-REQUEST` 的受控服务，不能宣称已经证明严格的
「地址和端口依赖过滤」或任意两点都无法打洞。参见 [RFC 5780](https://www.rfc-editor.org/rfc/rfc5780.html)。

### 电脑网络的假 IP 干扰及单变量对照

ZH2 实际把 STUN 请求发往 `198.18.x.x:3478`，这个地址有响应。
宿主机系统 DNS 同样把生产 STUN 域名解析到该假 IP。
再用同一个宿主机 UDP socket 顺序访问服务器真实 IP→假 IP→真实 IP，三轮均得到：
真实 IP 路径的公网端口为 X，假 IP 路径为 Y，X≠Y，回访真实 IP 仍为 X。
因此，域名路径和直接 IP 路径确实具有不同的映射，不能默认 STUN 和 peer 流量总走相同出口。

为了判断这是否足以解释失败，在宿主机运行独立 Edge WebRTC 对端，手机运行同版本 M124 原生探针。
USB HTTP 仅交换 SDP/候选，数据通道仍走真实网络；没有 TURN，不把中继算成直连。

| 手机移动网络 → 宿主机探针 | 独立连接次数 | 结果 |
| --- | --- | --- |
| 双方使用生产 STUN 域名 | 3 | 0/3 直连，均约 15.1 秒进入 failed，无 echo |
| 双方只将 STUN 改成当时解析出的服务器真实 IPv4 | 3 | 0/3 直连，均约 15.1 秒进入 failed，无 echo |

每次创建新的浏览器进程及 PeerConnection，并重启手机探针，观察约 20 秒。
每轮双方均成功交换公网 srflx 候选。**静态写死 STUN IP 没有修复本次连接**，所以没有把它加入产品。
宿主机对照表明失败并非只发生在 ZH2 虚拟机；但独立 Edge 探针不是已安装桌面应用，
也不是 UU。手机设备列表当时没有可连接的 ZH 宿主机条目，因此未将探针冒充宿主机产品实测。

### 对开源实现和 UU 对比的结论

[RustDesk 客户端](https://github.com/rustdesk/rustdesk/blob/master/src/client.rs) 除 WebRTC 外，
还有 UDP、TCP、IPv6 等可选建连路径；[Tox 协议](https://toktok.ltd/spec.html) 还描述了
双方协调、结合多节点观测的打洞及端口尝试。这些能力超出了当前应用仅依赖 WebRTC ICE 的直连路径。
它们提供改进方向，不代表某一策略在本次目标依赖映射下必定成功，也不是 UU 实现的证据。

本轮可以排除「只是手机 UI 超时」「ZH2 没发包」「没有 srflx」「只有虚拟机才失败」这些单一解释。
新的实证是手机映射随目标变化，以及电脑网络存在假 IP/分流和映射差异；两者都会增加普通 ICE 直连难度。
未进行 WAN 两侧抓包、完整过滤测试或同端点 UU A/B，因此不把具体责任点和 UU 的成功原因写成定论。

后续提高直连覆盖率，应先用同一手机、同一电脑、同一网络获得 UU 的实际选中链路证据，
再验证双端 IPv6、STUN 与 peer 路径一致性，以及原生多传输打洞。
中继保证会话可用，但必须与 P2P 成功率分开统计；单纯延长超时或增加 STUN 数量没有本次实测支持。

原始候选、公网地址、抓包和探针源码仅保存在本地 `.codex-tmp/p2p-investigation/`。
主要证据为 `rigorous-vm-packets-*`、`nat-phone.log`、`nat-host.json`、`nat-host-fakeip.json`、
`cellular-host-{1,2,3}-*` 和 `cellular-host-literal-{1,2,3}-*`。
本轮没有新增产品代码改动；此前局域网 VPN 修复和 Web 兼容验证结果仍分别成立。

### 正式 APK 收尾复验

恢复原无诊断日志的修复 APK 后，18:17:31、18:18:07、18:18:43 分别重启应用建立新连接，
每次启动后观察至少 30 秒，三次均为 `ZH2 · Relay`，即此次正式包复验为 **0/3 P2P**。
对应 `rigorous-clean-final-{1,2,3}`，每次均检查 ADB 成功、PID 连续及新 UI 状态。
这确认当前蜂窝网络下的失败并非仅发生于诊断 APK 或独立探针。

已移除临时探针和 `18318` ADB 转发，停止 PktMon 并删除本任务的抓包筛选器；
没有遗留 18317/18318 监听服务。手机保留移动网络，VPN 关闭，正式应用已恢复运行。
恢复 APK 的 SHA-256 为 `F9DB75D9C3603770BFB4F8A96FF8A55E04B544F8B8EDD5E09AC2315660678B60`。
