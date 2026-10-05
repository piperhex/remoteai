# admin-go 生产部署

生产后端只部署 `apps/admin-go`，管理页面与 Go 程序使用同一个镜像。
`apps/admin` 的 NestJS 源码已冻结，仅用于本地兼容对照测试。
以下命令从仓库根目录执行，不包含任何具体生产主机或凭据。

## 文件下载数据面与独立计费开关（2026-10-05）

升级前应用 `sql/20261005-chat-bulk-leases.sql`，即使暂不开启批量计费，也需要该表以保证
原计费路径识别未结算的下载额度。新安装的空库会自动创建该表。生产仍使用手动增量迁移。
必须先停止旧 Go 实例接入再切换；不识别新预留表的版本不能与新版混合承接计费转发。

管理端「聊天设置 → 文件下载 → 文件校验下载（试用）」对应 `fileBulkEnabled=0/1`，默认关闭。
仅双方及当前路径支持二进制协议时，新任务才使用 bulk。旧客户端继续兼容模式。
关闭后停止新任务使用 bulk；已有任务在下一次控制请求时停止，并从已校验断点重新协商。

`CHAT_BULK_LEASES_ENABLED=false` 是独立的服务端开关。保持关闭时，bulk 继续调用原有
`Meter.Transmit`。开启后，writer 只对已排队、已通过授权与限速的记录申请一次性字节租约：
接口上限 1 MiB，当前队列将每批进一步限制为 256 KiB、最多 16 条记录；不为凑批等待。
每条 socket 写入前检查过期与连接状态，并在记录间优先处理控制消息。

租约绑定账号、电脑、计费时段、唯一租约 ID、唯一 writer 和额度 epoch。PostgreSQL 原子预留，
Redis 确认额度 fence；只允许一次 writer claim，不接管或重新使用崩溃进程的租约。
租约最多有效 2 秒，已获准开始的 socket 写入允许结束。账户最多 4 个活动租约、64 个未解决租约；
额度不足或账本失败时停止发送，不能先发后补。原有成功 socket 写入的封装字节口径保持一致，
不把浏览器提交点或 transport credit 当作计费依据，也不声称 socket 成功代表对端已收到文件。

最终结算使用单调累计成功字节数，重复结算不重复收费。能证明未尝试发送的部分才释放；
写入失败、丢失结算响应或进程崩溃留下的未知部分保持 `reserved`，到期只转为 `uncertain`。
原 writer 在到期后仍可提交一次最终结果；持久化 claim 和 receipt 标记区分过期占用与已结算结果，
不会因此重新授权发送或重复结算。没有最终结果时继续占用额度。
未知额度不自动退款，也不自动伪装成成功流量；`chat_relay_bulk_leases` 保留账号、writer、
成功字节数和占用字节供审计。终态记录保留 30 天，未知记录必须在核对持久化证据后人工处理。

回退计费只需关闭 `CHAT_BULK_LEASES_ENABLED` 并滚动重启本版本，原逐帧路径会继续扣除
尚未解决的租约占用。回滚到不认识此表的旧 Go 镜像之前，必须停止新租约并完成全部未知额度对账，
确认不存在 `reserved>0`，再使用已验证镜像；不要删除记录、清空 Redis 或用 TTL 模拟退款。
本轮没有开启生产开关或部署。目标设备内存、弱网、RPC P95 与完整下载耗时门槛见
[下载管理与验收](../../docs/mobile-download-manager.md)，未满足门槛前保持两个开关关闭。

## 手机推送与 Windows 无人值守（2026-09-28）

已有数据库先备份，再执行 `sql/20260928-chat-push.sql` 和
`sql/20260928-desktop-service.sql`，然后更新 Go 镜像。两项功能默认关闭。
推送使用 Expo 转发 APNs；服务器设置 `CHAT_PUSH_ENABLED=true`，按项目配置
`EXPO_PUSH_ACCESS_TOKEN`。移动构建设置和真机验收步骤见
[远程可靠性说明](../../docs/remote-reliability.md)。禁止将访问令牌放进客户端构建变量。

Windows 无人值守设置 `DESKTOP_SERVICE_ENABLED=true`，并更新桌面、手机和 Web。
普通账号认证的 `/devices/:deviceId/service-credential` 用于颁发和撤销设备授权；
`/desktop-service/revoke` 只接受服务自己的设备凭据，不能套用 Kong 的账号 JWT 插件。
Kong 新增受保护路径 `/chat-push`，新增直达 Go 的 `/desktop-service/revoke`；
已有 `/device-chat`、`/device-switch` 的 WebSocket 升级和超时设置继续保留。
参考 `kong/existing-kong.example.yml` 增量调整现有路由，不覆盖整份生产配置。

凭据只允许指定账号的指定电脑作为远程宿主上线，不授权账号 HTTP 接口或手机查看端。
轮换、设备菜单撤销或服务主动注销会拒绝旧凭据的新连接，并关闭该实例上的旧服务连接。
多实例部署尚未加入跨实例撤销广播，其他实例上的已有连接最多保留到一小时授权到期；
配置即时撤销要求时先使用单个协调实例。断网时媒体访问也受到本地授权截止时间约束。
删除离线设备时同时删除其服务凭据，重新登记同一设备不会恢复旧授权。

回滚仅使用已验证的 Go 镜像并保留新增表。先关闭以上开关、撤销服务授权并在电脑上停用服务。
服务端推送队列会保留未完成记录，回滚期间不发送；不要删除队列来模拟成功投递。
Windows 安装、锁屏/登录验收与限制见 [无人值守说明](../../docs/windows-unattended.md)。

## 设备上报防刷（2026-09-24）

本次更新无需 SQL 迁移。部署前将 `TRUSTED_PROXY_CIDRS` 配置为实际入口代理地址的
明确 `/32` 或 `/128`，保留现有环境变量；默认不信任任何转发头。代理地址改变时必须同步更新。
默认请求与新增安装限额、兼容变化、验证方式见 [TELEMETRY.md](TELEMETRY.md)。
仅更新 Go 镜像即可启用服务端保护；桌面测试隔离在更新代码后生效。

## 远程聊天转发升级（2026-09-23）

启动新版 Go 服务前应用 `sql/20260923-chat-relay-budgets.sql`。切换时停止旧 Go
实例，再启动新版；旧版计费不识别预留额度，不能和新版同时承接转发。
客户端可以逐步更新：二进制转发按每条 WebSocket 连接协商，旧客户端继续使用 JSON。

转发额度由 PostgreSQL 持久化预留，每份最多 256 KiB、有效期最多 5 秒，并在整点切换。
Redis 原子扣减和确认每帧用量；网络写入期间不持有数据库或分布式锁。
后台每 5 秒结算过期预留，正常报表可能延迟约 5–10 秒。额度下调会撤销尚未使用的旧预留，
已开始发送的帧允许完成。多实例共用同一 PostgreSQL 和 Redis；临近额度上限时，其他实例
可能短暂等待已预留但尚未使用的额度释放。

Redis 故障时转发停止放行，P2P 不受此计费路径影响；不能退回仅检查数据库历史用量。
保留 Redis AOF 和持久卷，避免把此处的 Redis 键作为普通缓存清理。重启后后台会恢复结算
过期预留；仍有未确认发送的预留等待至到期后一分钟，再按已确认及结果不明的部分计费。
如果整份 Redis 记录丢失，或者 Redis 重启、主从切换导致记录属于旧进程，按该份数据库预留
全额计入，防止持久化回退后重复发放额度；这可能保守多计
该份尚未使用的流量（每份最多 256 KiB）。额度修改过程中发生存储故障时会保留阻断状态，
修复存储后重新保存该用户额度即可恢复。
如配置 Redis ACL，需要允许脚本读取 `INFO server`，用于确认记录所属的 Redis 进程。

若需回滚，仅使用已验证的 Go 镜像：停止新版接入，保持 Redis 可用并等待所有
`chat_relay_budgets` 未结算记录完成（含未确认发送的恢复期），确认没有 `closed=false`
记录后再启动旧 Go 实例。保留新增表，不要删除未结算预留。

## 已有环境与新安装

已有环境沿用 PostgreSQL、Redis、Kong、数据库目录和密钥。记录当前 Go 镜像 ID、Compose
项目名、所有 Compose 文件、网络、端口与数据容器的 ID/启动时间。保留服务器上的 `.env`
和 `compose.override.yml`；不要用示例覆盖现有配置。正常更新只操作 `admin-go`。

新安装先复制 `apps/admin-go/.env.example` 为同目录的 `.env`，设置真实数据库密码，
为 `KONG_JWT_SECRET`、`JWT_REFRESH_SECRET` 分别生成随机密钥，并限制文件访问权限。
`KONG_JWT_KEY` 与 Kong JWT credential 的 key 保持一致；已有安装的三个值必须保持原样。
管理配置中的 SMTP 等密文也依赖原密钥，不能在升级时重新生成。

`ADMIN_GO_DB_NETWORK`、`ADMIN_GO_KONG_NETWORK` 必须对应实际 Docker 网络。
已有数据库网络即使仍叫 `admin_backend-internal` 也应保留，不要因为迁移目录而重建。
`POSTGRES_HOST` 和 `REDIS_HOST` 填写各自在该网络上的地址；保留实际出站代理
`CODEX_OUTBOUND_PROXY`，有意直连时留空。Go 容器已提供 `host.docker.internal` 映射。

仅在全新安装、尚无数据服务时，创建指定的数据网络并启动可选依赖：

```sh
docker network create codex-switch-data
sudo install -d -m 0750 /srv/codex-switch/postgres
docker compose --project-name codex-switch-data --env-file apps/admin-go/.env \
  -f apps/admin-go/compose.infrastructure.yml up -d postgres redis
```

这份文件不运行 NestJS，也不启动 Go 或 Kong。PostgreSQL 使用配置的宿主机目录，
Redis 使用持久卷。已有数据服务不执行这组新装命令。Kong 网络由现有网关管理。

## 本地验证、构建和打包

先确认目标提交已提交且工作区干净；存在其他改动时使用独立检出目录。
运行 `npm run check:backend`、`npm run check -w @codex-switch/admin-ui`，
然后执行 Docker 的 `verify` 阶段（Linux race tests 与 vet）。
首次迁移或修改认证、数据格式、PC/手机协议时，还需运行 [README](README.md) 中的隔离对照测试。

构建平台必须匹配服务器。以下 PowerShell 示例假设服务器为 `linux/amd64`：

```powershell
$targetCommit = (git rev-parse HEAD).Trim()
$imageTag = "codex-switch/admin-go:$targetCommit"
docker build --platform linux/amd64 -f apps/admin-go/Dockerfile --target verify -t codex-admin-go:verify .
if ($LASTEXITCODE -ne 0) { throw 'Go container verification failed' }
docker build --platform linux/amd64 -f apps/admin-go/Dockerfile -t $imageTag .
if ($LASTEXITCODE -ne 0) { throw 'Production image build failed' }
$imageId = (docker image inspect $imageTag --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Image inspection failed' }
$archive = Join-Path ([IO.Path]::GetTempPath()) "admin-go-$targetCommit.tar"
docker image save --output $archive $imageTag
if ($LASTEXITCODE -ne 0) { throw 'Image archive failed' }
Get-FileHash -LiteralPath $archive -Algorithm SHA256
```

记录提交、平台、镜像 tag/ID 与文件 SHA-256，用 `scp` 上传到服务器受保护的部署记录目录。
使用文件传输，不把二进制镜像管道接入 PowerShell 文本处理。镜像中不包含生产 `.env`。
下载源不通时可使用 `GOPROXY`、`NPM_REGISTRY` 构建参数，不修改代码或关闭依赖校验。
服务器网络命令应遵循该环境已配置的代理要求。

## 数据库与配置

升级前备份 PostgreSQL 和 Redis，并确认备份可读取。数据库升级脚本位于 `sql/`，
只有确认缺失且兼容的升级才按版本顺序执行；目录移动不代表需要重新运行已应用的 SQL。
生产保持 `POSTGRES_DB_SYNCHRONIZE=false`。它不是增量迁移开关，不能升级已有数据库。

设备管理分别切换代理接口与 Codex GUI 模型需要先执行
`sql/20260924-device-gui-model-selection.sql`，再更新 admin-go、Web/移动端及桌面端。
新增的 `guiAccountId`、`guiProviderId` 字段仅保存 GUI 选择，不修改代理接口当前配置。
旧桌面端仍支持原有代理切换，GUI 切换会提示更新；回滚 Go 镜像时保留新增字段即可。

模型计价预设需要 `sql/20260923-token-cost-presets.sql`。已有库确认缺少
`token_cost_preset_settings` 时，在备份后执行该增量脚本；它只新增配置表，不修改用户数据。

密码登录锁定需要 `sql/20260923-user-login-locks.sql`。更新应用前，在备份后为已有库执行该脚本，
新增 `user_login_locks` 表以保存账号的连续错误次数和锁定截止时间。脚本可重复执行，不修改已有用户。
应用镜像回滚时保留该表即可；旧镜像不会执行新的登录锁定规则。

个人聊天流量和每月额度需要 `sql/20260923-chat-user-traffic.sql`。先备份并执行脚本，
新增用户额度、月用量和小时用量表，再更新 admin-go 与管理页面。默认额度为 `-1`（不限量），
每月按北京时间自动切换统计周期。个人历史从升级后开始记录；旧的全站统计无法拆分到用户。
内置管理员自动获得新权限，自定义管理角色需授予 `admin.chat-traffic.read` 和按需授予
`admin.chat-traffic.manage`。旧 Go 镜像可以保留新增表回滚，但不会执行新额度限制。

全新空数据库第一次启动可以临时在 `.env` 设置 `POSTGRES_DB_SYNCHRONIZE=true`，
由 Go 初始化完整结构；初始化成功后改回 `false`，仅重建 Go 服务。
不要将 `internal/migrations/001_legacy_schema.sql` 直接导入已有库。

HTTP 默认只发布 `127.0.0.1:8080`，Kong 通过容器网络访问 Go。保留实际生产别名和覆盖文件。
内置 STUN 默认监听并发布 UDP 3478；`CHAT_STUN_URLS=stun:你的公网域名:3478`
需要匹配公网映射、安全组和防火墙。UDP 不经过 Kong。
可选 TCP 打洞发现服务使用 `CHAT_TCP_URLS=tcp://你的公网域名:3478`，
并设置 `CHAT_TCP_LISTEN=0.0.0.0:3478`，开放公网 TCP 3478。
Compose 使用 `ADMIN_GO_TCP_BIND` / `ADMIN_GO_TCP_PORT` 控制宿主机映射。
`CHAT_TCP_URLS` 留空时不启动 TCP 服务，也不向客户端启用新路径；映射端口仍由 Compose 预留，
若该 TCP 端口已有其他服务，需调整映射或在覆盖文件中删除它。
可用逗号填写最多两个发现地址；第二个应位于另一公网地址以提供冗余。
IPv6 需使用 `tcp://[公网IPv6]:3478` 并配置对应 IPv6 监听、容器路由及防火墙。
发现服务必须直接接收 TCP 连接，不能放在会改写来源地址的 HTTP 反向代理后面。
它只返回连接来源地址，不中转聊天内容；远程桌面视频仍使用原有 ICE/TURN。
当前新增 TCP 路径支持桌面与 Android；Web、iOS 和旧客户端继续使用现有 WebRTC/中转。
PC 发起端和被控端都需要带 TCP 协商的版本；仅更新被控端不会为旧 PC 发起端启用 TCP。
服务端在会话恢复时重新下发已协商的 TCP 发现配置，原生层据此恢复目标地址权限。
如果客户端网络把发现域名解析为 `198.18.0.0/15` 等代理假 IP，应优先使用运维确认的固定公网 IP
配置 STUN 与 TCP 发现地址，例如 `stun:公网IPv4:3478` 和 `tcp://公网IPv4:3478`。
使用同一本地 socket 对比域名与实际 IP 的映射，再从公网验证 UDP/TCP 发现回应。
字面 IP 可以消除该域名解析路径的干扰，但不能保证跨 NAT 打洞成功，也不绕过客户端网络策略。
使用外部 STUN 或设置 `CHAT_STUN_PORT=0` 时，应在覆盖文件中用 `ports: !override`
移除基础 UDP 映射，避免它指向端口 0；按需保留 HTTP 和 TCP 发现端口，此语法需要 Compose 2.24.4+。

## 加载并更新 Go

服务器仓库必须能快进到已验证的目标提交，禁止 reset 或强制覆盖本地改动。
先记录运行镜像并创建回滚 tag，再校验上传文件的 SHA-256，使用 `docker image load --input`
加载镜像，并核对镜像 ID、Linux 平台与本地记录一致。
`ADMIN_GO_IMAGE` 可指定提交 tag；未设置时沿用 `codex-switch/admin-go:local`。
如沿用原镜像引用，将已验证的新镜像 ID 标记到该引用；保留单独的回滚 tag。

使用实际观察到的项目名。以下为默认项目的 Bash 示例，自动带上已有 Go 覆盖文件：

```bash
set -Eeuo pipefail
go_compose=(docker compose --project-name admin-go --env-file apps/admin-go/.env -f apps/admin-go/compose.yml)
if test -f apps/admin-go/compose.override.yml; then
  go_compose+=(-f apps/admin-go/compose.override.yml)
fi
"${go_compose[@]}" config --quiet
"${go_compose[@]}" up -d --no-deps --no-build --pull never admin-go
```

不要在加载本地镜像后重新构建，不运行整栈 `down` 或 `--remove-orphans`。
更新 Go 不需要重启 PostgreSQL、Redis、Kong 或 Web。数据库和 Redis 的 ID/启动时间应保持不变。

独立 Web 的入口在 `apps/web/compose.yml`。需要更新 Web 时另行构建、上传并使用原 Web
项目名更新 `web`；已有 Web 容器不能改用新项目名再启动一份。
全新 Web 安装可选择独立项目名。它不依赖或启动 NestJS，默认网络别名为 `codex-switch-web`。

## Kong

新网关参考 [existing-kong.example.yml](kong/existing-kong.example.yml)，
Go 上游为 `http://codex-switch-admin-go:8080`，Web 上游为 `http://codex-switch-web:80`。
自定义 `ADMIN_GO_KONG_ALIAS` 时使用实际别名。已有 Kong service 的名称和 ID 可以保留，
只修改必要的上游地址；不要覆盖其他路由、插件、TLS 或超时设置。
DB-backed Kong 通过已确认的 Admin API 管理；声明式 Kong 应持久化修改原配置。

`/auth`、`/admin` 等公开路径和受保护的 `/sync`、`/devices`、`/admin/api` 都指向同一 Go 进程。
公开路由还需包含 `/token-cost-presets`，供 PC 启动时读取计价预设；保持 `strip_path=false`。
`/device-switch`、`/device-chat` 必须保留 WebSocket Upgrade；首帧在 Go 内校验 JWT。
JWT 插件使用 `key_claim_name=iss`、`claims_to_verify=exp`、`run_on_preflight=false`。
`/web` 指向独立 Web 服务并启用 `strip_path=true`。

Kong 的 worker 配置和 DNS 缓存可能晚于修改生效。重建容器后应核对新 IP，并在限定时间内
重复公网检查；不能仅凭 Admin API 返回成功判断流量已切换。若需更换别名，应先在持久化
Compose 配置中加入并验证新别名，再更新相应上游。不要为了刷新缓存重启整个网关。
Go 为兼容旧接口保留了 `X-Powered-By: Express`，该响应头不能判断实际运行语言。

## 验收与回滚

启用远程桌面视频中继时，按 [DESKTOP-RELAY.md](DESKTOP-RELAY.md) 追加 Compose 文件并验证视频与控制。
以后每次更新、回滚都要带上同一份中继 Compose 文件，保留私有环境变量、端口和网络。

- 容器使用预期镜像且持续运行，无重启循环；同时读取 stdout/stderr，确认 `admin-go listening`。
- 本机和公网 `/admin`、页面静态资源返回 200；未登录 `/auth/me` 返回 401。
- 使用专用测试账号和模拟设备验证两个公网 WebSocket、设备指令确认、PC/手机配对、
  双向加密转发、手机恢复和桌面会话重建，不向真实用户的 PC 发送测试指令。
- 从服务器外部发起 UDP STUN Binding 请求。HTTP 正常不能证明公网 UDP 可达。
- 验证数据库、Redis 未被重建或重启；删除临时测试账号并保存部署记录。

出现确认的更新故障时，恢复已记录的上一版 admin-go 镜像及其兼容配置，使用同一 Compose
项目和文件执行 `up -d --no-deps --no-build --pull never --force-recreate admin-go`，
再执行相同验收。回滚只使用 Go 镜像，不启动 NestJS；不自动恢复数据库备份覆盖在线数据。
首次迁移在旧服务停止前完成并行验证；缺少已验证的 Go 回滚镜像时应在切换前解决这一条件。
## 聊天原生直连节点

聊天直连可增加 EasyTier 用户态内核；配置未开启或任一端为旧客户端时，继续使用原有链路。
需要先更新桌面和手机原生包，再配置 Go 服务。Web 浏览器继续使用 WebRTC。

使用 `compose.chat-connectivity.yml` 作为现有 Go Compose 栈的附加文件，构建上下文为仓库根目录。
节点源码固定在 `crates/chat-connectivity/Cargo.lock` 对应的版本；不要改用不固定版本的公共节点镜像。

```dotenv
CHAT_NATIVE_PEERS=udp://p2p.example.com:11010,tcp://p2p.example.com:11010
CHAT_NATIVE_STUN=stun-a.example.com:3478,stun-b.example.com:3478
CHAT_RENDEZVOUS_SECRET=replace-with-a-separate-random-secret-at-least-32-characters
```

`CHAT_NATIVE_PEERS` 最多四个自有节点地址。开放节点的 11010/TCP 和 11010/UDP；双栈域名应同时具备
A/AAAA 记录及 IPv6 防火墙放行。`CHAT_NATIVE_STUN` 需要至少两个独立可用的 UDP STUN 端点，检测不同目的地址
下的 NAT 映射；不要把同一端点的重复名称当成独立服务器。节点只负责发现和打洞协调，禁用数据转发，不计作 P2P 中继。
原有 WebSocket 中继继续兜底。发布前检查节点监听、STUN 可达性，以及两端的 `path-state` / `path-selected` 诊断。

回滚时清空 `CHAT_NATIVE_PEERS`，重启 admin-go；新会话自动回到原有连接方式。活跃会话会在正常关闭或过期时释放内核。
这项变更不自动部署上述节点，也不代表已获得特定运营商网络下的成功率数据。
