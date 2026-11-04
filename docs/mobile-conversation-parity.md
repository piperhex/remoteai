# 手机对话展示验收

Android 原生聊天以 PC Codex GUI 的内容样式为参照。正在处理时，过程说明和工具活动直接显示在聊天里。
手机用抽屉查看历史处理过程、工具详情、计划、文件差异和报错，其余内容保持相同的文字层级、
代码高亮、审查卡片和文件修改摘要。

## 展示约定

- 最终回复使用 14px 正文；处理过程中的说明使用 13px 灰色正文。
- 当前页面里运行过的任务完成后保持过程展开；重新打开已完成的历史对话时，处理过程默认收起。
- 活动按时间顺序逐项显示并持续更新；点击某项工具打开详情，关闭后回到原聊天位置。
- 运行中的工具图标与文字同步扫光；任务结束、应用进入后台或系统开启减少动态效果时停止。
- Markdown 保留标题层级、删除线、引用、任务清单、表格对齐和链接。长内容按完整块分批显示。
- 代码默认横向滚动，可切换自动换行；复制保留完整内容。命令输出使用简洁文本区，长输出分段阅读。
- 普通工具输出保留原始文本；结构化文本按 Markdown 展示，每段约 8,000 字符，支持复制全文。
- Android 超长内容可保存为完整文本文件，避免剪贴板大小限制；普通长度仍直接复制。
- 合法的 `::code-comment` 显示为审查卡片，文件行号打开文件抽屉；围栏示例和未完成的指令保持文本。
- 实际文件修改显示增删行和行号，可切换统一、并排视图并复制原始差异。
- 抽屉内容跟随正在运行的任务更新，逐层返回可回到处理过程。
- 阻塞式补充问题使用提交回答的卡片；异步补充问题从待答入口打开抽屉，可选择选项或填写回答。

## 实时过程与长输出补充验收：2026-09-13

- 实体手机发起真实对话，两条 PowerShell 命令产生 `INLINE-START`、`INLINE-END` 和 `INLINE-SECOND`。
  运行时的过程说明和命令直接显示在聊天里，与 PC 同轮对话一致；完成后保持展开，重新进入历史时收起。
- 键盘展开时，实时内容到达后立即可读，不再被初始滚动定位的加载提示遮住。
- 70 秒真实命令的连续截图确认扫光同时经过图标和文字，底色文字始终清晰；完成后恢复静态。
- 35 秒真实命令运行中打开详情，先看到 `LIVE-A`，同一抽屉随后收到 `LIVE-B` 和退出码 0。
- PC 长工具文本、结构化结果和命令输出改为滚动接近底部时连续加载，保留已读内容及复制全文。
  Edge 鼠标滚动测试覆盖向下续载、读到命令末尾、向上返回前文及展开长输出后继续输入。
  Markdown 跨加载边界的代码块保持连续；流式追加不会改变用户正在阅读的位置。

本次截图位于 `.codex-tmp/phone-pc-parity/`：`inline-process-keyboard-closed.png`、
`inline-process-completed.png`、`inline-process-reopened.png`、`inline-sweep-contact.png`、
`inline-live-output-open.png`、`inline-live-output-updated.png` 和 `inline-sweep-finished.png`。
PC 同轮对照位于 `.codex-tmp/vm-runtime-test/inline-process-pc-running.jpg` 和
`inline-process-pc-completed.jpg`；滚动验收为 `.codex-tmp/command-output-scroll.png` 和
`.codex-tmp/tool-output-scroll.png`。本节取代下方早期记录中 PC 使用页码按钮的行为说明。

本次通过原生端 214 项测试、桌面端 785 项 Vitest 测试及 8 项配置编辑器测试、2 项 Edge 滚动测试。
Android Release 构建成功并已覆盖安装到实体手机；Clippy 检查通过。

## 真机记录：2026-09-13

本次使用 USB 连接的 Android 实体手机，连接同一局域网内 Windows 虚拟机中的 PC 应用。
对话、命令和文件修改均由真实模型及 PC 工作区产生，并与电脑端同轮对话对照。

| 场景 | 已验证结果 | 本地截图 |
| --- | --- | --- |
| Markdown 与代码 | 表头、任务清单、中文代码及语法高亮正常显示；代码复制出现成功反馈 | `updated-format-bottom-real.png`、`copy-code-success.png` |
| 合法审查指令 | 显示橙色边框的审查卡片和蓝色文件链接；点击文件及行号打开文件抽屉 | `final-review-code-files.png`、`final-diff-file-preview.png` |
| 预期命令失败 | 实际输出 `STEP-1`、等待后输出 `STEP-2`，按要求以退出码 3 结束；手机可查看输出并复制 | `expected-failure-details.png`、`copy-output-success.png` |
| 45 秒流式输出 | 实际命令运行期间，打开的详情持续接收输出；完成前可看到新增内容 | `live-command-start.png`、`live-command-end.png`、`live-command-completed.png` |
| 实际文件差异 | `apply_patch` 修改文件后，手机显示本轮增删行；统一、并排、换行和复制差异可用 | `diff-unified-wrap.png`、`diff-split.png`、`copy-diff-success.png` |
| 暂停任务 | 手机暂停正在运行的任务，随后显示已停止状态 | `stop-confirmed.png`、`stopped-turn.png` |
| 继续任务 | 暂停后从手机继续，任务完成并返回回复 | `continue-completed.png` |
| 允许审批 | 实际操作触发“请求批准”，手机允许后命令执行并以退出码 0 完成 | `approval-accepted.png` |
| 拒绝审批 | 手机拒绝实际审批后显示“已拒绝”，本轮任务停止 | `approval-declined.png`、`declined-process.png` |
| 图片工具 | 本地绘制 PNG 后实际调用 `view_image`；手机抽屉显示图片，点击可放大并返回 | `final-image-tool.png`、`final-image-preview.png` |
| 最终命令样式 | 工作目录、耗时、命令、输出及退出码与 PC 同轮内容一致；命令与输出可分别复制 | `final-command-details.png` |
| 前后台切换 | 退到后台再返回，连接、当前命令详情及输出保留 | `foreground-restored.png` |
| 完成后回答问题 | 手机选择 `Short list` 并提交；两端待答卡消失，显示同一答案及模型回复 | `async-idle-selected.png`、`async-idle-submitted.png` |
| 运行中回答问题 | 活动轮等待期间在手机填写 `Finish verification now`；两端立即显示答案，模型继续完成修改 | `async-running-custom.png`、`async-running-submitted.png` |
| 长行差异 | 实际替换文件的一行；统一和并排均支持换行，左右对应行等高，横向滚动可读到 `END-MARKER` | `long-diff-unified-wrap.png`、`long-diff-split-wrap.png`、`long-diff-split-scroll-end.png` |
| 最终版短按 | 键盘展开时多行发送、新问题刚出现时打开抽屉均通过；再经过三轮开关（含侧边抽屉切换），短按与提交仍正常，答案在命令运行期间送达 | `dynamic-touch-new-entry.png`、`final-touch-cycle-1.png`、`final-touch-cycle-2.png`、`final-touch-cycle-3.png`、`final-touch-answer-submitted.png` |
| 浏览器长输出 | 实际页面快照返回约百万字符，手机分为 131 段，第一页与第二页切换正常；原始 JSON 包装、链接和文字与 PC 一致 | `final-browser-tool-page1.png`、`final-browser-tool-pagination.png`、`final-browser-tool-page2.png` |
| 超长内容保存 | 超出 Android 剪贴板容量时打开保存抽屉；实际导出 1,048,605 字节 UTF-8 文件，保留 1,047,802 个 UTF-16 字符及末尾第 4,448 号元素；普通回复复制仍成功 | `final-large-output-save-offer.png`、`final-large-output-saved.png`、`final-normal-copy.png` |

手机截图位于本地 `.codex-tmp/phone-pc-parity/`；PC 对照图位于 `.codex-tmp/vm-runtime-test/`，
包括 `review-scenario-pc-bottom.jpg`、`tool-scenario-pc-command-details.jpg` 和
`approval-scenario-pc-command-details.jpg`、`final-scenario-pc-bottom.jpg`、
`final-scenario-pc-command-details.jpg` 和 `final-scenario-pc-image-tool.jpg`。截图是本地验收产物，不随文档提交。
较早的截图包含修正前样式；格式不完整的审查指令保持文本，不作为合法审查卡片的验收依据。
审批验收结束后，访问权限已恢复为“帮我批准”。
PC 与手机均将上述浏览器结果分为 131 段，PC 对照见 `final-browser-tool-pc-output-end.jpg`。
单独请求 `functions.exec` 输出的测试在两端都未出现工具结果，不计入工具输出验收。
超长工具结果已保存到手机“下载/Remote AI”，本地导出核对记录为 `export-validation.json`。
工具原始文本中的包装格式不保证是合法 JSON，保存时按原文保留，不补写或改动内容。

## 未验证范围

- 本次模型没有提供可调用的真实计划工具，因此未验证真实计划事件；计划抽屉的实现和自动测试不等同于真机通过。
- 本次已验证本地图片查看；音频播放与模型图像生成尚未实测。
- 本记录不包含 H5、iOS、蜂窝网络或跨 NAT 的验收。

## 自动检查

本次已通过的检查：

- Android TypeScript 检查及原生测试：45 个测试文件、208 项测试通过。
- Rust 测试：1,098 项通过、5 项忽略。
- Rust 格式检查及 `cargo clippy --all-targets -- -D warnings`。
- 桌面 TypeScript/Vite 生产构建。
- 桌面完整测试：777 项 Vitest 测试及 8 项配置编辑器测试通过。

Markdown、代码高亮及审查指令的 12 项测试包含在原生测试中。可在仓库根目录复查：

```powershell
npm --prefix apps/native run check
npm --prefix apps/native run test -- markdownTree codeHighlight markdownContent
```

这些检查覆盖格式保留、代码高亮的性能上限、审查指令边界及文件链接校验；真实聊天与最终安装包仍以真机记录为准。

## 抽屉触摸修复

真机发现侧边抽屉关闭后，动态出现的回答入口和键盘展开时的发送按钮偶尔收不到点击。
已回移 Gesture Handler 上游 [PR #3832](https://github.com/software-mansion/react-native-gesture-handler/pull/3832)，
仅在侧边抽屉打开时启用其关闭手势。保持 Expo 53 使用的 2.24.0 版本。
补丁在安装依赖和加载 Metro 配置时校验并应用；版本或上下文变化时要求重新审查，不静默跳过。
最终 Release 安装包已在真机复测，未保留临时触摸诊断。覆盖安装后自动恢复 P2P 连接，无需重新登录。
