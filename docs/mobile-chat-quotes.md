# Android 聊天引用与复制

聊天使用统一的浅灰背景，输入框保持白色。回复、引用详情、代码、命令输出和差异的复制图标跟随对应文字末尾，
空间不足时随文字换行。点击后显示勾号，复制的原文不包含图标占位符。

长按聊天文字可以复制、全选或引用，保留 Android 的选区手柄。“全选”作用于当前文字块；
整条回复或完整工具输出可以通过末尾的复制图标复制。系统可能另外提供搜索、翻译等操作。
Android 文字需持续按住至少 500 毫秒才进入选择；系统设置了更长的长按时间时遵循系统设置。
快速连点和短暂停留不选字，滑动、增加手指或中断触摸会取消等待；选中后的手柄拖动继续使用系统交互。
Web 和原生公式内容同步限制触摸选择，Web 的鼠标拖选、双击选词和键盘选择保持可用。
工具栏贴近所选文字，点击聊天空白处会取消选择并关闭工具栏。靠近左侧边缘也可以长按选择，
侧滑仍可打开聊天列表，竖向滚动和从页面中部横滑不会打开列表。

每条引用分别显示为胶囊，点击打开详情抽屉。发送前可独立移除；发送后聊天记录中也保留独立胶囊，
正文单独展示。引用使用现有 PC 文本格式发送，历史记录重新加载后仍可打开引用，不修改存储原文。
最多添加 8 条引用，每条最多 16,000 个 UTF-16 字符；重复选择同一消息的同一段内容不会重复添加。

USB 连接的 Android 14 真机已通过真实对话发送两条引用并收到模型回复，也验证了历史胶囊、引用详情、
原文复制、原生全选复制，以及键盘展开和收起时的背景区分。
本地截图位于 `.codex-tmp/phone-pc-parity/`，包括 `sent-quotes-gray-real.png`、
`sent-quote-details-aligned-real.png` 和 `gray-composer-keyboard-real.png`。
最终安装包还在真机上验证了左侧长按、拖动手柄扩大选区、空白取消、已发送引用的详情选择，
截图为 `selection-edge-near-text-real.png`、`selection-handle-expanded-real.png`、
`quote-details-selection-final-real.png` 和 `chat-selection-dismissed-final-real.png`。

纯逻辑测试覆盖引用限制、去重、发送格式、成功发送后的清理、历史引用解析及畸形文本保留。
Android 自动交互检查使用 `apps/desktop/e2e/android-quote-regression.mjs`，仅允许运行在可清空数据的模拟器上。
Android 15 模拟器完整流程通过：原文复制、全选、独立引用、预览、删除、去重、发送、空白取消、
代码复制和引用、聊天切换清理、历史胶囊恢复、侧滑开关列表。报告位于
`.codex-tmp/android-quote-regression/quote-report.json`。原生端 47 个测试文件、227 项测试通过。
本次原生选择菜单的实现和设备验收范围为 Android，未验证 iOS。

Android 的 Editor 不转发自定义选择回调的 `onGetContentRect`，因此插件通过派生的 ReactTextView
包装原生 ActionMode 回调，仅调整聊天选区的顶部锚点，保留系统选区边界、手柄和生命周期。
抽屉依赖补丁同时移除了关闭状态下的零距离拖动阈值：Android 将该阈值与方向阈值按“或”处理，
零距离会截走静止长按的松手事件，导致文字高亮却没有菜单。

长按防误触回归使用独立的 `com.codexswitch.mobile.selectiontest` 应用，不改动主应用的数据。
Android prebuild 后，以 `apps/native/e2e/text-selection.init.gradle` 构建 Release 测试包，
再运行 `node apps/native/e2e/text-selection-test.mjs`（需 `ANDROID_HOME`、`JAVA_HOME`，
`ANDROID_SERIAL` 默认为 `emulator-5580`）。检查快速连点、短按、长按、全选、复制、引用、
内嵌链接、公式选择与滚动，结果写入 `.codex-tmp/text-selection/`。
Web 回归位于 `apps/web/e2e/text-selection.pw.ts`，纳入聊天及 Markdown 的 Playwright 配置，
覆盖 Chromium 手机视口、WebKit 手机视口和桌面布局。
