# Remote AI Web

面向手机浏览器的 Remote AI Web 客户端，同时提供宽屏桌面布局。移动交互使用
Ant Design Mobile，桌面增强使用 Ant Design，应用状态由 Redux Toolkit 管理。

## 在线使用

访问 [Codex Web](https://codex.onepiper.cloud/web/)。

使用前，请先安装 [Remote AI PC 端](https://github.com/piperhex/remoteai/releases)，
再打开 **Codex GUI**，按页面提示完成安装。
保持 PC 端运行并联网，在网页端登录与 PC 端相同的云端账号，即可连接电脑开始使用。

## 本地运行

先启动后端，再从仓库根目录运行：

```bash
npm run dev:web
```

开发服务器会把认证、同步、设备和 WebSocket 请求代理到 `http://127.0.0.1:8080`。
需要连接其他本地后端时可设置 `VITE_DEV_API_URL`，聊天信令同样通过 `/device-chat` 代理。

## Codex 聊天

底部导航和桌面侧栏均提供“聊天”入口。登录与 PC 相同的云端账号后，选择在线电脑，
即可查看和搜索 Remote AI 内置 GUI 的聊天、发送消息、查看流式回复、补充要求、停止任务，
以及新建聊天、归档恢复、选择模型、处理审批和补充问题。界面与 Android 客户端保持一致。

Web 和 Android 共用聊天状态、历史同步、加密及重连逻辑。浏览器优先使用 WebRTC 直连 PC，
直连失败后通过 admin 加密中转。切换导航或浏览器进入后台时断开连接，返回后重新同步当前聊天。
聊天正文只保留在当前页面内存中。手机软键盘弹出时输入区随可视区域调整；Enter 换行，
Ctrl/Cmd + Enter 发送，中文输入法选词不会触发发送。

PC 与 admin 需更新到支持聊天的版本；部署方式与限制见 [手机连接 PC 聊天](../../docs/mobile-chat.md)。
生产环境使用 HTTPS，以支持安全的浏览器连接与账号登录。

```bash
npm run build:backend
npm run test:chat:e2e -w @codex-switch/web
```

## 账号与设置页面回归

账号页工具栏提供“一键消耗”：为当前用户全部可用账号各发送一次简短请求，按钮显示处理进度，
完成后提示结果并刷新用量。无需选择账号。此操作会产生真实用量；未确认完成的请求不会自动重发。
Web 和 admin-go 需要一同更新，新接口位于现有受 JWT 保护的 `/sync` 路由下，
要求 `self.accounts.write` 权限。没有可用凭据的账号会跳过，Codex 凭据始终留在后端。

账号卡片、分组详情、2FA 搜索与排序、设置和关于页与移动端保持一致，并提供桌面布局。
账号详情可查看动态验证码和重置卡；2FA 云端同步开关位于设置页。网页版由服务端更新，
关于页提供当前版本与历史版本入口，不显示手机安装包更新操作。

每次打开网页都会检查已部署的版本。有新版时可选择“忽略本版本”或“立即更新”；忽略记录保存在当前浏览器，
仅对该版本生效。“立即更新”会刷新网页加载新版。构建会生成 `version.json`，部署时需与其他静态资源一同发布。

```bash
npm run test:management:e2e -w @codex-switch/web
```

测试使用本机样例账号和设备，不连接真实云端账号。覆盖 320px、390px 和桌面宽度，
检查详情返回、重置卡确认、验证码复制与排序、设置保存，以及请求未完成时的页面操作。
报告与截图保存在 `.codex-tmp/web-management-report` 和 `.codex-tmp/web-management-playwright`。

## 浏览器与 Android 聊天验证

浏览器回归在手机尺寸和桌面尺寸下操作实际 H5 页面，连接本机 PC/admin 测试端，
覆盖直连、加密中转、聊天操作及重连；不请求真实模型。需要本机 Edge，
其他环境可设置 `CHAT_TEST_BROWSER=chromium` 并安装 Playwright Chromium。
报告与截图保存在 `.codex-tmp/h5-chat-report` 和 `.codex-tmp/h5-chat-playwright`。

Android Chrome 实测使用可丢弃的 Android 15 模拟器。首次在该模拟器的 Chrome 中完成欢迎页，
选择不登录账号。测试通过 ADB 连接模拟器内的 Chrome，保留实际手机视口与软键盘。

```powershell
$env:ANDROID_SERIAL = 'emulator-5580'
$env:ANDROID_CHAT_DISPOSABLE = '1'
adb -s emulator-5580 reverse tcp:1422 tcp:1422
npm run test:chat:android -w @codex-switch/web
```

该流程执行完整 H5 聊天回归，并检查实际软键盘、进入后台后的连接清理及返回前台后的恢复。
完整设备截图和环境记录位于 `.codex-tmp/h5-android-playwright`，报告位于 `.codex-tmp/h5-android-report`。

## 容器与 Kong

生产构建默认使用 `/web/` 作为静态资源前缀。`apps/web/compose.yml` 将独立 `web` 容器加入
`ADMIN_GO_KONG_NETWORK` 指定的现有网络，Kong 通过 `codex-switch-web:80` 提供 `/web` 路由。
云端 API 由 admin-go 提供，构建上传与更新步骤见 [生产部署](../admin-go/DEPLOYMENT.md)。

完成镜像构建、上传和回滚镜像保留后，在部署服务器的仓库根目录运行：

```bash
# web 替换为已有 Web 容器的实际 Compose 项目名。
npm run deploy:web -- check --project-name web
npm run deploy:web -- up --project-name web
npm run deploy:web -- verify --project-name web
```

命令保留现有 Compose 文件列表，只更新 Web，并等待健康检查、核对镜像和网络。
使用其他变量文件时传入 `--env-file`；追加覆盖文件使用 `--file`（可重复）。
回滚时将已验证的旧镜像恢复为配置中的镜像引用，再使用相同项目与配置执行 `up --force-recreate`。
检查成功后还需确认公网页面、静态资源和 `version.json` 正常。

API 请求保持同源并携带 `Authorization: Bearer <JWT>`；`/sync`、`/devices` 和
`/admin/api` 由 Kong JWT 插件校验，登录和刷新令牌接口保持公开。

如果 Web 使用独立域名并从根路径发布，可在构建容器时设置
`VITE_WEB_BASE_PATH=/`，并通过 Kong 的 Host 路由将该域名指向 Web 服务。

## 搜索与分享信息

`index.html` 包含页面标题、简介、规范网址、Open Graph / Twitter 分享信息及 `WebApplication`
结构化数据。分享图使用 `public/codex-switch.png`，复用项目现有的 512px 应用图标。

这些网址默认指向官方站点 `https://codex.onepiper.cloud/web/`。使用自己的域名或部署路径时，
请在构建前同步修改 `index.html` 中的规范网址、`og:url`、分享图网址及结构化数据中的网址；
`VITE_WEB_BASE_PATH` 只控制资源路径，不会改写这些绝对网址。
