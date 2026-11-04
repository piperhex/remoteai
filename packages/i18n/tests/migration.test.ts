import loungeAttachments from '../src/catalogs/client/zh/loungeAttachments.json';
import remoteCommand from '../src/catalogs/client/zh/remoteCommand.json';
import toolResults from '../src/catalogs/client/zh/toolResults.json';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { resources as client } from '../src/catalogs/client';
import { createI18n } from '../src/engine';
import { createErrorFormatter } from '../src/errors';
import gitConflicts from '../src/catalogs/client/zh/git-conflicts.json';
import gitActivity from '../src/catalogs/client/zh/gitActivity.json';
import discovery from '../src/catalogs/client/zh/discovery.json';
import deviceScreen from '../src/catalogs/client/zh/deviceScreen.json';
import messageQueue from '../src/catalogs/client/zh/messageQueue.json';
import ssh from '../src/catalogs/client/zh/ssh.json';
import downloadSelection from '../src/catalogs/client/zh/downloadSelection.json';
import downloadTiming from '../src/catalogs/client/zh/downloadTiming.json';
import downloadWorkspace from '../src/catalogs/client/zh/downloadWorkspace.json';
import commandMetrics from '../src/catalogs/client/zh/commandMetrics.json';
import requestErrors from '../src/catalogs/client/zh/requestErrors.json';
import chatQuota from '../src/catalogs/client/zh/chatQuota.json';
import chatCredits from '../src/catalogs/client/zh/chatCredits.json';
import chatSettings from '../src/catalogs/client/zh/chatSettings.json';
import codexStatus from '../src/catalogs/client/zh/codexStatus.json';
import sheet from '../src/catalogs/client/zh/sheet.json';
import projectBrowserFiles from '../src/catalogs/client/zh/projectBrowserFiles.json';
import projectEditorWindow from '../src/catalogs/client/zh/projectEditorWindow.json';
import conversationWorkspace from '../src/catalogs/client/zh/conversationWorkspace.json';
import accountAlias from '../src/catalogs/client/zh/accountAlias.json';
import filePreview from '../src/catalogs/client/zh/filePreview.json';
import projectActions from '../src/catalogs/client/zh/projectActions.json';
import groups from '../src/catalogs/client/zh/groups.json';
import projectExplorer from '../src/catalogs/client/zh/projectExplorer.json';
import mappingHub from '../src/catalogs/client/zh/mappingHub.json';
import mappingEditor from '../src/catalogs/client/zh/mappingEditor.json';
import jsonPreview from '../src/catalogs/client/zh/jsonPreview.json';
import modelSelection from '../src/catalogs/client/zh/modelSelection.json';
import npmScripts from '../src/catalogs/client/zh/npmScripts.json';
import gitBlame from '../src/catalogs/client/zh/gitBlame.json';
import remoteDesktopAccess from '../src/catalogs/client/zh/remoteDesktopAccess.json';
import lounge from '../src/catalogs/client/zh/lounge.json';
import loungeModeration from '../src/catalogs/client/zh/loungeModeration.json';
import loungeMobile from '../src/catalogs/client/zh/loungeMobile.json';
import loungeNewChat from '../src/catalogs/client/zh/loungeNewChat.json';
import loungeOrdering from '../src/catalogs/client/zh/loungeOrdering.json';
import loungeNames from '../src/catalogs/client/zh/loungeNames.json';
import loungeMenus from '../src/catalogs/client/zh/loungeMenus.json';
import loungeAssistance from '../src/catalogs/client/zh/loungeAssistance.json';
import loungeNotifications from '../src/catalogs/client/zh/loungeNotifications.json';

const baselines = {
  "client": "751b7f50aca5a2ebf8976190600fd93ce74f94673b73390a87c6fc153bdc6e22",
};

// New complete templates added after migration are covered by the catalog completeness checks.
const additions = new Set(['client.chat.usePlugin',
  ...Object.keys(remoteCommand),
  ...Object.keys(toolResults),
  ...Object.keys(gitConflicts),
  ...Object.keys(gitActivity),
  ...Object.keys(discovery),
  ...Object.keys(deviceScreen),
  ...Object.keys(messageQueue),
  ...Object.keys(ssh),
  ...Object.keys(downloadSelection),
  ...Object.keys(downloadTiming),
  ...Object.keys(downloadWorkspace),
  ...Object.keys(commandMetrics),
  ...Object.keys(requestErrors),
  ...Object.keys(chatQuota),
  ...Object.keys(chatCredits),
  ...Object.keys(chatSettings),
  ...Object.keys(codexStatus),
  ...Object.keys(sheet),
  ...Object.keys(projectBrowserFiles),
  ...Object.keys(projectEditorWindow),
  ...Object.keys(conversationWorkspace),
  ...Object.keys(accountAlias),
  ...Object.keys(filePreview),
  ...Object.keys(projectActions),
  ...Object.keys(groups),
  ...Object.keys(projectExplorer),
  ...Object.keys(mappingHub),
  ...Object.keys(mappingEditor),
  ...Object.keys(jsonPreview),
  ...Object.keys(modelSelection),
  ...Object.keys(npmScripts),
  ...Object.keys(gitBlame),
  ...Object.keys(remoteDesktopAccess),
  ...Object.keys(lounge),
  ...Object.keys(loungeModeration),
  ...Object.keys(loungeMobile),
  ...Object.keys(loungeNewChat),
  ...Object.keys(loungeOrdering),
  ...Object.keys(loungeNames),
  ...Object.keys(loungeMenus),
  ...Object.keys(loungeAttachments),
  ...Object.keys(loungeAssistance),
  ...Object.keys(loungeNotifications),
  'client.remoteDesktop.takeoverTitle', 'client.remoteDesktop.takeoverMessage',
  'client.remoteDesktop.takeoverConfirm', 'client.remoteDesktop.takeoverCancel',
  'client.remoteDesktop.connectionInUse', 'client.remoteDesktop.connectionCancelled',
  'client.appearance.globalFontSize', 'client.appearance.globalFontDescription',
  'client.appearance.followGlobalFont', 'client.appearance.followGlobalFontDescription',
  'client.appearance.guiFontSettings',
  'client.settings.followSystem',
  'client.settings.twoFactorKeyCloudSync',
  'client.chat.attachments.count', 'client.chat.attachments.view', 'client.chat.attachments.details',
  'client.chat.attachments.viewFile', 'client.chat.attachments.name', 'client.chat.attachments.path',
  'client.chat.attachments.size', 'client.chat.attachments.modified', 'client.chat.attachments.bytes',
  'client.chat.attachments.loading', 'client.chat.attachments.unavailable', 'client.chat.attachments.pathPending',
  'client.chat.attachments.folderSize',
]);

it('preserves the complete pre-migration Chinese, English and Russian copy', () => {
  for (const [module, resources] of Object.entries({ client })) {
    const dictionaries = resources as Record<string, Record<string, string>>;
    const entries = Object.keys(dictionaries.zh)
      .filter(key => key !== 'client.app.webPageTitle' && !key.startsWith('client.skills.') && !additions.has(key))
      .map(key => [dictionaries.zh[key], dictionaries.en[key], dictionaries.ru[key]])
      .sort((a, b) => a[0].localeCompare(b[0], 'en'));
    expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex'))
      .toBe(baselines[module as keyof typeof baselines]);
  }
});

it('keeps context separate and accepts code + params without interpreting parameter values', () => {
  const app = createI18n({ locale: 'en', resources: client });
  expect(app.t('client.chat.apply')).toBe('Apply');
  const format = createErrorFormatter(client);
  expect(format('en', { code: 'client.conversation.manageProject', params: { value1: '取消 {value1}' } }))
    .toBe('Manage project: 取消 {value1}');
  expect(format('ru', 'account_id=42 /home/project/source.ts {name}'))
    .toBe('account_id=42 /home/project/source.ts {name}');
  expect(app.text('取消')).toBe('取消');
});
