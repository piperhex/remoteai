import { formatRemoteError } from '../../../../../shared/localization/errors';

// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import { translateMessage } from "../../../../../shared/localization/messages";
import type { Language } from "../../../../../shared/localization/language";
import { GuiDevicePicker } from "../../../../../shared/conversation/GuiDevicePicker";
import { QueuedMessages } from "./QueuedMessages";
import type { MessageQueue } from "./messageQueue";
import { TaskEditor } from "./scheduledTasks/TaskEditor";
import { TaskRow } from "./scheduledTasks/TaskRow";
import type { ScheduledTask } from "./scheduledTasks/types";

const UNCERTAIN = "上次发送结果尚未确认，请查看聊天后决定是否重发。";
const LOAD_ERROR = "暂时无法加载定时任务，请稍后重试。";
const RUST_TASK_ERROR = "任务未能执行，请确认 Codex 可用后重试。";
const HAN = /[一-鿿]/;

/** Russian copy is curated elsewhere; assert that the displayed text is the dictionary value. */
function russianOf(source: string) {
  const value = formatRemoteError("ru", source);
  expect(value).not.toBe(source);
  expect(value).not.toMatch(HAN);
  return value;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGuiLanguage("zh");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  document.body.innerHTML = "";
  setGuiLanguage("zh"); vi.unstubAllGlobals();
});

const task: ScheduledTask = {
  id: "task", title: "Nightly", prompt: "Check", cwd: "", schedule: { kind: "daily", time: "09:00" },
  status: "active", nextRunAt: null, lastRunAt: null, lastThreadId: null, lastTurnId: null,
  runStatus: "idle", error: RUST_TASK_ERROR,
};

/** Renders a fresh element after switching language, like a parent re-rendering on a language change. */
async function renderIn(language: Language, render: () => ReactElement) {
  setGuiLanguage(language);
  await act(async () => root.render(render()));
  return document.body.textContent ?? "";
}

it("shows a stored Rust task error in the interface language and keeps Chinese verbatim", async () => {
  const row = () => <TaskRow task={task} busy={false} onAction={() => {}} />;
  expect(await renderIn("zh", row)).toContain(RUST_TASK_ERROR);
  expect(await renderIn("en", row)).toContain("Could not run the task. Make sure Codex is available and try again.");
  expect(await renderIn("ru", row)).toContain(russianOf(RUST_TASK_ERROR));
});

it("translates the scheduled task load error shown in the editor", async () => {
  const editor = () => <TaskEditor initial={{ title: "", prompt: "", cwd: "", schedule: { kind: "daily", time: "09:00" } }}
    editing={false} busy={false} error={LOAD_ERROR} onClose={() => {}} onSave={async () => false} />;
  expect(await renderIn("zh", editor)).toContain(LOAD_ERROR);
  expect(await renderIn("en", editor)).toContain("Could not load scheduled tasks. Try again later.");
  expect(await renderIn("ru", editor)).toContain(russianOf(LOAD_ERROR));
});

it("translates the restored queue item warning when it is displayed", async () => {
  const queue = () => <QueuedMessages threadId="thread" running={false} connected editDisabled={false}
    queue={{} as MessageQueue} onEdit={() => {}} messages={[{ id: "queued", text: "hello", images: [], skills: [],
      model: "", effort: "", access: "read-only", needsReview: true, error: UNCERTAIN }]} />;
  expect(await renderIn("zh", queue)).toContain(UNCERTAIN);
  expect(await renderIn("en", queue)).toContain("Could not confirm whether the last message was sent.");
  expect(await renderIn("ru", queue)).toContain(russianOf(UNCERTAIN));
});

it("names this computer in the device picker tooltip in the interface language", async () => {
  const picker = () => <GuiDevicePicker busy={false} onSelect={() => {}} navigation={{ current: null, devices: [],
    authenticated: true, loading: false, error: "", refresh: () => {}, choose: () => {}, login: () => {} }} />;
  const title = () => host.querySelector("button")?.getAttribute("title");
  await renderIn("zh", picker);
  expect(title()).toBe("当前设备：本机");
  await renderIn("en", picker);
  expect(title()).toBe("Current device: This computer");
  await renderIn("ru", picker);
  expect(title()).toBe(translateMessage("ru", "client.workspaceSettings.currentDevice", { value1: russianOf("client.composer.thisComputer") }));
});
