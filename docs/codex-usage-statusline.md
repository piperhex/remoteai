# 官方 Codex 窗口的会话统计栏

Remote AI 会在官方 Codex 的输入框下方显示当前会话的输出速度、缓存命中率和上下文占用。
它与「今日 Token、费用、账号余额」共用增强功能的加载入口，不需要安装或应用皮肤。

启用 Remote AI 的本地代理，再通过 Remote AI 连接官方 Codex 即可使用。
「显示今日用量」只控制今日 Token、费用和账号余额；关闭后，输出速度、缓存命中率和上下文占用继续显示并刷新。
退出代理模式时，统计栏会移除并停止刷新；重新进入时自动恢复。
支持中文、英语、俄语和日语，随 Remote AI 的语言设置切换。
Remote AI 自己的聊天页和网页版继续使用原有统计界面。

![官方 Codex 输入框下方的会话统计栏示例](images/codex-conversation-usage-statusline.png)

## 指标含义

- 输出速度：复用 Remote AI 原有代理请求计时，只汇总当前会话已完成的有效请求。
  使用输出 Token 总数除以输出阶段耗时总和，不包含首响应等待、请求间等待及工具执行时间。
  每两秒通过现有本地增强通道刷新；没有有效请求计时时显示「—」，不回退到采样估算。
  统计范围沿用 Remote AI 的已保留请求记录（每会话最多 500 条），与账户页的多会话平均值范围不同。
- 缓存命中率：官方 Codex 当前会话累计缓存输入 Token 除以累计输入 Token；
  按 Token 数加权，不平均各次调用的百分比，也不回退到最近一次调用。累计数据缺失时显示「—」。
- 上下文占用：官方 Codex 当前会话的上下文 Token 除以模型窗口大小。它与账号剩余额度是两项独立指标。
  圆环和文字使用同一百分比：29.1% 对应约三成圆弧，0% 或数据未知时只显示淡色底环。
  统计栏沿用 Codex 的次要文字颜色，并使用 13px 文字和 14px 图标，随明暗主题切换。
  上下文圆环使用与上方圆环相同的颜色，尺寸缩为 14px、1.4px 线宽；文字大小保持不变。

缓存和上下文数据来自官方 Codex 已加载的当前本地会话；新版 Codex 使用本地会话的只读用量订阅，
旧版继续读取已加载的会话管理器。速度读取 Remote AI 已有的请求计时，独立于缓存和上下文数据刷新。
统计栏只读这些状态，不发送模型请求、不读认证文件、
不扫描会话历史，也不启动额外的 HTTP 服务。会话切换、新建草稿和多个输入框并存时，不推断其他会话的数据。

## 开发验证

统计栏通过 `speed_selector_overlay_expression` 与原有用量脚本一起加载；正常模型刷新和连接恢复共用同一入口。
`native_registry_reader.js` 同时供上下文设置和统计栏发现本地会话管理器使用，统计栏不会创建上下文设置适配器。
可翻译文案维护在 `packages/i18n/platform/desktop/overlays/usage-statusline.js`。

```sh
npm run generate:i18n
node --test scripts/codex-native-usage-subscription.test.mjs scripts/codex-usage-metrics.test.mjs scripts/codex-usage-statusline.test.mjs
node --test scripts/codex-usage-statusline.browser.test.mjs scripts/codex-usage-recovery.test.mjs
node --test scripts/codex-usage-overlay.test.mjs scripts/codex-context-settings.test.mjs
npm run check:i18n
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

重新编译 Remote AI 后才会包含这项源码修改；现有安装不会因为修改工作区中的 JavaScript 自动更新。
