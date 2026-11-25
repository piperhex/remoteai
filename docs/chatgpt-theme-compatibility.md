# ChatGPT 桌面主题兼容性

## Windows 商店包 26.1120.6357.0（2026-11-25）

在客户端 26.1120.50957 的主页上，同一张宽幅壁纸已经加载到 `body`，主题文字和输入框颜色也已生效。
工作区新增的 `[data-app-shell-surface-backing]` 绘制了不透明白底，外层框架还叠加了一层白色渐变。
宽幅主题现在清除这两层装饰底色，保留输入框、卡片以及原生窗口布局。新版标题栏位于主内容区外，
通过 `header[data-app-shell-titlebar]` 识别；侧栏收起时也能识别同一工作区。

主题切换和图片导入现在检查运行中的窗口，并核对窗口实际加载的主题版本。
如果在主题页打开后退出 ChatGPT，下次点击应用时会先询问是否重新启动。已确认的 Windows 重启先请求窗口正常关闭，
随后重新启动选定的安装。增强模式会等待可见工作区；商店版持续只返回隐藏工作区时，同一次启动会再激活窗口一次。

本机一次旧版启动在 13:44 建立进程后长时间挂起，没有窗口，也没有监听端口。
独立配置目录的注册启动别名也出现挂起。Windows 同时反复记录同一个 AppX 容器的销毁事件；
随后系统恢复启动，单凭这些事件无法确定系统阻塞的原因。修复后的重启命令在 7.5 秒返回，
约 12 秒时确认新主进程的窗口可见、壁纸和所选主题版本匹配。1280 px 和 840 px 视口均已截图核对。
桌面远程和 Web 的重启指令最终由目标电脑执行；ChatGPT 原生窗口的样式只在目标电脑加载。

截至排查当日，上游正式版为 [v1.5.21](https://github.com/Fei-Away/Codex-Dream-Skin/releases/tag/v1.5.21)。
新版标题栏适配 [#456](https://github.com/Fei-Away/Codex-Dream-Skin/pull/456) 和仅有隐藏页面时重新激活的
[#457](https://github.com/Fei-Away/Codex-Dream-Skin/pull/457) 均待合并。
macOS 的 [#472](https://github.com/Fei-Away/Codex-Dream-Skin/issues/472) 报告了相似的背景缺失现象，
其原因仍需 macOS 实机确认。

## Windows 包版本 26.1021.3705.0（2026-10-24 验证）

会话滚动区域新增了独立的 sticky 渐隐层，位于 `[data-app-action-timeline-scroll]` 内，
但不属于 `[data-thread-scroll-footer]`。其类名由 CSS Modules 生成（`_fade_…`），
旧版 `.bg-gradient-to-t` 和 footer 直接子节点规则均无法覆盖，导致输入框上方出现白色渐变横条。

Windows、macOS 样式同步适配该装饰层：仅匹配滚动区域内同时带有 `aria-hidden="true"`、
`.pointer-events-none` 和 `_fade_` 类名的节点，清除背景，不更改定位、尺寸、滚动留白或功能卡片。

回归测试先确认两平台旧样式均能复现问题，再验证修复后的新旧结构、浅色→深色→浅色切换、
关闭皮肤恢复原样、草稿保留及功能卡片渐变不受影响。相关渲染、启动和资源流程共 26 项测试通过，
`npm run check:i18n` 通过。

Windows 实机“海底潜航”会话截图确认白条已消失；修复前后输入框、权限提示、渐隐层的尺寸与位置、
滚动位置和草稿均一致。macOS 通过浏览器回归验证，未做实机验收。
桌面远程聊天和 Web PC 不加载 ChatGPT 客户端注入样式，代码检查确认没有对应装饰层，无需同步修改。

本机 Remote AI 安装目录已同步两个平台 CSS，原文件保存在
`.codex-tmp/theme-footer-20261024/installed-assets-backup`，当前窗口已自动生效，无需重启。
正式分发需包含本次内置 CSS 修复。

## Windows 包版本 26.928.3736.0（2026-10-02 验证）

会话底部的装饰层从 `.bg-gradient-to-t` 改为 `.bg-surface`，仍位于
`[data-thread-scroll-footer]` 的直接子节点。旧规则只清除了渐变层，新版不透明底色
因此在输入框周围形成整条白色区域，切换皮肤后仍会遮挡背景。

Windows、macOS 样式现同时覆盖旧渐变层和新版带 `aria-hidden="true"`、
`.pointer-events-none` 的底部装饰层，仅清除背景，保留布局、输入框和功能卡片底色。
回归用例覆盖两端新旧结构、浅色→深色→浅色切换、草稿保留及关闭皮肤后恢复原样。

Windows 实机已确认当前“海底潜航”皮肤的底部白条消失，输入框尺寸和位置不变。
macOS 通过浏览器回归验证。本机安装目录已同步两个平台的 CSS，原文件保存在
`.codex-tmp/theme-footer-20261002/installed-assets-backup`；正式分发需包含本次 CSS 修复。

## Windows 26.924.20706（2026-09-26）

实机通过 Microsoft Store 从 `26.915.4065.0` 更新至包版本 `26.924.1866.0`。
更新后 `app.asar/package.json` 中的客户端版本是 **26.924.20706**。

上游 [Codex-Dream-Skin #414](https://github.com/Fei-Away/Codex-Dream-Skin/issues/414)
报告相同版本应用主题后对话栏消失；排查时该报告仍开放、没有修复回复。
对照上游主分支 `34335d27d54300eccb325cc652f6c93fef428b84`（v1.5.18）及本地实际 DOM 排查。

### 根因与适配

- 新版把 `data-app-shell-main-content-top-fade` 放在整个内容容器上。
  旧兼容选择器将它与装饰渐隐层合并，再应用 `display: none`，导致主页和会话内容全部隐藏。
  现在只匹配渐隐层的旧类名或 `_MainContentTopFade_` 类名，并仅清除背景。
- 新主页的 `group/home-composer-layout` 自行管理公告、标题和输入框布局。
  旧版首子节点的固定高度规则会撑高空公告栏、造成输入框溢出；现已排除该现代布局。
  非宽图主题改由现代主页容器绘制插画，不再依赖旧版插画卡片。
- 输入框内层、新项目操作栏和侧栏新增了独立背景。
  现已清除重复输入框底色，适配项目栏、侧栏及新版文字与卡片颜色变量，保留原生字体设置。
- 启动超过 1.8 秒的页面此前会被错误缓存为已注入，后续不再重试。
  现在只有验证成功才缓存，等待期间只保留一个观察器；关闭主题时取消等待。
  桌面宠物及其合成窗口不参与主题注入和主窗口验证。

Windows 和 macOS 的公共页面适配均已同步。实机验收限于 Windows；macOS 通过浏览器回归验证。

### 验证方式

实机验证主页、已有会话、深浅色切换、背景、输入框、项目栏、侧栏和提示卡片。
检查内容容器非零尺寸、输入框内层背景透明、主页不再发生额外纵向溢出。

```sh
node --test scripts/dream-skin-renderer.test.mjs scripts/dream-skin-bootstrap.test.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests dream_skin_native
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:desktop
```

浏览器用例覆盖新旧结构、宽图及竖图、内容容器可见性、主页空公告栏、内层底色、文字与背景配色、
保留字体及草稿、重复注入和清理。启动用例覆盖慢加载、失败后重试、等待取消和宠物窗口排除。

本机调试将已验证的 CSS 和 renderer 文件同步到 Remote AI 安装目录，并在
`.codex-tmp/theme-compat/installed-assets-backup` 保留原文件。正式分发仍需包含本次改动的
Remote AI 构建；主题预设资源包不包含这些内置兼容代码。
