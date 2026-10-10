# 远程桌面视频中继

聊天的 WebSocket 中继只传信令，不能替代 WebRTC 的 TURN 视频中继。视频优先直连；直连失败后
使用带短期凭据的 TURN UDP、TCP 或 TLS。配置仅下发到已认证的桌面会话，聊天连接仍使用原来的 ICE 配置。

## 部署

在已有 Go 服务的 Compose 文件和私有 override 后追加 `-f apps/admin-go/compose.desktop-relay.yml`。
后续更新与回滚必须保留这个文件，避免误删端口和网络配置。先备份环境文件与当前 Go 镜像。
保持 PostgreSQL、Redis、Kong 和原有配置不变；无需新增数据库表，沿用现有中继额度和结算表。

在私有 `.env` 中配置以下变量（示例域名和地址必须替换）：

```dotenv
DESKTOP_TURN_URLS=turn:relay.example.com:3479?transport=udp,turn:relay.example.com:3479?transport=tcp,turns:relay.example.com:5349?transport=tcp
DESKTOP_TURN_SECRET=<独立生成的至少32字符随机密钥>
DESKTOP_TURN_REALM=codex-switch
DESKTOP_TURN_PUBLIC_IP=<服务器公网IPv4>
DESKTOP_TURN_TLS_LISTEN=0.0.0.0:5349
DESKTOP_TURN_TLS_CERT_URL=http://certificate-manager/private-certificate
```

TLS 证书接口只能放在受信任的私有网络，返回 PEM 格式的 `{"cert":"...","key":"..."}`。
已有 Kong 证书管理可使用其私有 `/certificates/<SNI>` 接口。不要向公网暴露该接口或打印响应。
也可使用容器内只读 PEM 路径 `DESKTOP_TURN_TLS_CERT`、`DESKTOP_TURN_TLS_KEY`。
服务每分钟刷新证书，刷新失败时保留上一份可用证书；已有连接不受证书替换影响。

公网开放 Go 监听的 **3479/UDP、3479/TCP、5349/TCP**，以及 coturn 的
**50000–50199/UDP** 分配端口。TURN 域名必须直接解析到服务器；普通 HTTP 反向代理不支持这些端口。
有云安全组时同时放行这些端口。容器 NAT 和同服务器的分配端口互访须实测。

启动脚本读取容器自身的 IPv4，设置明确的 `relay-ip` 和 `external-ip=公网/容器地址` 映射。
这使同一服务器上的两个中继分配可以在容器内互通，不依赖云网络的公网地址回流能力。
不要把 `0.0.0.0` 当作中继地址；它只用于监听。coturn 会为映射中的容器自身地址建立精确例外，
其他内网地址仍受禁止访问规则限制。容器必须保持单一 IPv4 网络，启动时地址不明确会直接失败。

coturn 的 **3478 认证监听端口只允许私有 Docker 网络访问**，不可发布或转发到公网。
客户端必须经过 Go 计量入口：每次媒体转发先检查现有账号额度，成功转发后计入流量；额度不足
或记账服务不可用时停止转发。两端都经中继时，每次实际经过计量入口的上传、下载都会计量。
媒体仍为端到端加密的 SRTP；计量服务不会解码屏幕内容。

UDP 收包与计量转发使用独立循环，避免一次记账等待阻塞后续关键帧分片的接收。
每个连接的每个方向最多缓冲 1 MiB、排队 1024 包；整个代理最多缓冲 16 MiB，
字节上限包含正在计量的包。满额时丢弃新包，连接关闭时释放队列；逐包鉴权、额度检查和记账保持不变。
这用于吸收短时突发，不保证持续拥塞或长时间记账延迟下无丢包。

```bash
# 将下列文件参数附加到已核对的原项目、env、override 参数中。
# coturn 以非 root 用户读取挂载的脚本；环境文件仍应保持私有权限。
chmod 644 apps/admin-go/scripts/turn-entrypoint.sh
docker compose ... -f apps/admin-go/compose.desktop-relay.yml config --quiet
docker compose ... -f apps/admin-go/compose.desktop-relay.yml up -d --no-deps desktop-turn
docker compose ... -f apps/admin-go/compose.desktop-relay.yml up -d --no-deps --no-build --pull never admin-go
```

凭据最长一小时且不超过聊天身份有效期，重新连接及持续在线每半小时刷新。已认证的活动分配可以继续刷新；
过期凭据不能建立新连接或新分配。除上述容器自身映射外，coturn 禁止转发至回环、内网、链路本地和组播地址，限制并发
分配数及单分配带宽。不要通过放开内网目标或公开私有监听器来绕过部署故障。

## 验证

HTTP 正常、出现 relay 候选、TURN Allocate 成功都不代表视频已经可用。需强制 relay 并验证选中的
ICE 候选、实际视频解码、鼠标、键盘、画质设置、关闭和重新连接，分别检查 UDP、TCP、TLS。
同时核对现有额度统计增加，以及配额耗尽后没有继续转发媒体。

`TestUDPKeyframeSurvivesAnAccountingPause` 在计量暂停期间发送 256 个 1200 字节的媒体包，
检查上传、下载的完整性、顺序、逐包计量和关闭后的缓冲释放。2026-10-10 的 Windows 本地复现中，
旧下载循环仅转发 56/256 包，分离接收后为 256/256；这是受控突发测试，不能代替公网实机验证。

本地隔离测试需要 Docker、Edge、Node 依赖和 Go；不会使用生产账号：

```powershell
$env:COTURN_INTEGRATION='1'
go -C apps/admin-go test ./internal/mediarelay -run TestCoturnBrowserVideoAndControls -v -count=1
# 另测 Windows 原生发送器，需已准备视频运行库和 Rust 工具链：
$env:COTURN_NATIVE_INTEGRATION='1'
go -C apps/admin-go test ./internal/mediarelay -run TestCoturnBrowserVideoAndControls -v -count=1
```

集成测试使用实际启动脚本及容器限制，公布不可路由的文档地址，验证双方强制中继时仍能互通。
临时 TLS 证书只用于本机隔离环境；公网验证保持正常证书校验。生产必须使用有效证书及默认的内网目标禁令。
回滚使用已记录的 Go 镜像和对应环境快照。不要执行整栈 `down` 或重启数据库、Redis、Kong。
