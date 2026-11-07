import { expect, it } from "vitest";
import { commandPreview } from "./commandPreview";
import { activityPreview, MAX_ACTIVITY_PREVIEW_CHARS } from '../../../../../shared/chat/activityPreview';
import { summarizeTool } from '../../../../../shared/conversation/toolDetails';

it("shows the script inside a known PowerShell command wrapper", () => {
  expect(commandPreview('"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'
    + ' -NoProfile -Command "Write-Output \'DISPLAY-FIRST\'"')).toBe("Write-Output 'DISPLAY-FIRST'");
  expect(commandPreview("pwsh -NoLogo -NonInteractive -c 'echo hello'")).toBe("echo hello");
  expect(commandPreview('powershell -Command Get-Date')).toBe("Get-Date");
});

it.each(['npm test', 'echo "powershell -Command hello"', 'app -Command "hello"',
  'powershell -File script.ps1', 'powershell -EncodedCommand aGVsbG8='])
  ("preserves commands it cannot safely abbreviate: %s", (command) => {
    expect(commandPreview(command)).toBe(command);
  });

it("keeps mixed legacy script quoting intact while omitting the known launcher", () => {
  expect(commandPreview('powershell -Command "unclosed')).toBe('"unclosed');
  const script = '\'Write-Output "legacy"';
  expect(commandPreview('"C:\\\\WINDOWS\\\\System32\\\\powershell.exe" -Command ' + script)).toBe(script);
});

it('preserves useful command text past the old limit and strips wrappers before bounding wire summaries', () => {
  const script = 'git diff -- ' + 'file-name.ts '.repeat(30);
  const command = '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
    + `"${script}"`;
  const item = { id: 'cmd', type: 'commandExecution', command, aggregatedOutput: 'private output' };
  const summary = summarizeTool(item, 'chat', 'turn');
  expect(summary.commandPreview).toBe(script.trim());
  expect(summary.command).toBeUndefined();
  expect(summary.aggregatedOutput).toBeUndefined();
  expect(item.command).toBe(command);
  expect(activityPreview(`  ${script}\n\n  next  line `)).toBe(script + 'next line');
  expect(summarizeTool({ ...item, commandActions: [{ type: 'read', path: script }] }, 'chat', 'turn')
    .commandActions?.[0].path).toBe(script.trim());
});

it('marks bounded Unicode previews with an ellipsis without splitting surrogate pairs', () => {
  const preview = activityPreview('😀文件 '.repeat(500));
  expect(Array.from(preview)).toHaveLength(MAX_ACTIVITY_PREVIEW_CHARS);
  expect(preview).toMatch(/^😀文件 .*…$/u);
  expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
});
