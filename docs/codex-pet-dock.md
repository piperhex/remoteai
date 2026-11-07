# 官方宠物额度底座

在 **设置 → 用量 → 宠物额度底座** 打开“显示额度底座”。默认关闭；设置保存在本机，随 Remote AI 启动恢复。

同一卡片的“显示文字标签”开关控制两侧数值上方的标题，默认关闭。关闭时只显示放大的数值，
数字水平居中并略向下偏移以贴合底座的视觉中心；打开时显示“五小时剩余 / 本周剩余”或
“剩余额度 / 总消耗”，数值恢复为适合两行布局的字号。余额和 Token 单位保留，长数值按可用宽度缩放。
开关状态保存在本机，无需重启 Codex；底座关闭时仍会保留标签偏好。无标题时也保留完整的无障碍说明。

布局为 **官方宠物 → 双额度底座 → 官方对话/任务卡片**。底座显示时隐藏原生快捷输入按钮栏。
关闭开关会恢复原生按钮和卡片位置。底座只显示数据，不接管宠物或卡片上的点击。

| 当前使用方式 | 左侧 | 右侧 |
| --- | --- | --- |
| 官方账号 | 五小时剩余百分比 | 周剩余百分比 |
| API 服务商 | 剩余额度；无限额 Key 优先显示钱包余额 | 该服务商累计 Token |

底座根据宠物实际宽度按 1.75 倍计算，保留背景图比例；宠物本身不缩放。
底座挂在宠物的原生移动容器中，拖动时共用同一次位移。
支持锚点定位的 Codex 版本中，任务卡片也直接跟随宠物定位，拖动时不再依靠下一帧修正位置。
卡片外层的透明区域不接收鼠标，实际卡片仍可点击；靠近屏幕底部时卡片自动显示在宠物上方，
左右边缘会保留卡片的可见空间。关闭底座后恢复原生卡片布局。

## 使用条件与状态

- 支持 Windows、macOS 上的官方 Codex 宠物；Mac 原生环境仍需实机验证。
- 官方 Codex 需由 Remote AI 的“ChatGPT 增强功能”建立连接。未连接时显示等待提示，
  可通过现有的启动/重启 Codex 操作建立连接；切换底座开关本身不重启 Codex。
- Codex 已连接但宠物未打开时，设置页提示打开官方宠物。
- 不依赖已安装皮肤。宠物页面刷新或重新打开后会自动重新连接。
- Remote AI 自带的本机/局域网网页版通过同一接口控制运行它的电脑。
  独立云端 Web 的设置页提供入口说明，当前不能从云端遥控此开关。
- 多账号并发或服务商分组暂不合并额度；显示未知，不会用某个账号的数据代表整组。
- 无对应的额度窗口、未配置余额查询、查询失败或累计数据库尚未建立时显示 `--`，不会假装为零。
- 若此前装过独立版 `CodexPetDockRemoteAI`，先停用独立版并取消其登录启动，再使用内置开关，
  避免两个程序同时控制同一个宠物窗口。

## 数据更新与退出

官方额度复用 Remote AI 已有的用量缓存，网络刷新周期仍由原账号刷新设置决定。
底座约每 2.5 秒读取一次缓存和累计 Token 表；不扫描请求历史、不迁移数据库。
API 余额使用 Remote AI 现有查询逻辑，每个当前配置最多每 60 秒发起一轮查询。
同一配置的请求不重叠，切换服务商或查询配置后不会采用旧请求结果。

所有文件、SQLite、余额网络请求和 Codex 连接操作都在后台完成。
宠物页面只接收数值、币种、语言和状态；不接收账号凭据、API Key、查询地址或钱包登录信息。
余额错误仅以布尔状态呈现，不把服务返回的错误内容传入页面。

关闭开关通常在下一次刷新恢复原样；若程序异常退出或连接丢失，页面在 20 秒未收到更新后自动恢复原生布局。
官方宠物页面结构变化可能影响布局兼容性，此时可以关闭功能继续使用原生宠物。

## 开发验证

```powershell
npm run generate:i18n
npm run check:i18n
npm run build:desktop
npm run build:web
npm exec --workspace @codex-switch/desktop -- vitest run --config scripts/vitest.config.ts src/pages/settings/PetDockSettingsCard.test.tsx
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib pet_dock
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib pet_surface_tests
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
node --test scripts/pet-dock-renderer.browser.test.mjs
```

浏览器测试默认使用 Playwright 自带的 Chromium，首次运行前执行 `npx playwright install chromium`。
Windows 上禁止用 `PLAYWRIGHT_CHANNEL` 切换到系统 Edge 或 Chrome，避免账户锁定，
详见[浏览器测试说明](browser-tests.md)。
测试在独立页面中验证拖动、尺寸、卡片、开关恢复和失联恢复，不连接用户正在使用的宠物。

底座图片和渲染器基于 MIT 开源项目 [Codex Pet Dock](https://github.com/hjxccc/codex-pet-dock)。
原许可证和来源说明随安装包分发，见 `apps/desktop/src-tauri/resources/pet-dock/`。
