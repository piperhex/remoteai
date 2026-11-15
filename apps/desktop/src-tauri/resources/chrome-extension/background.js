import * as permissions from './permissions.js';
import { execute } from './operations.js';
import { invalidate } from './snapshot.js';
import { stopDebugging } from './driver.js';
import { debuggerDetached, hasDebuggerConnections, finishClientConnections, connectionOwner }
  from './debugger-connections.js';
import { clearControlledTabs } from './tab-indicator.js';
import { forgetWorkTab, renameWorkGroups } from './tab-groups.js';
import { createBundleUpdater, UPDATE_ALARM } from './auto-update.js';
import { t } from './i18n.js';

const HOST = 'dev.codex_switch.chrome';
const running = new Map();
const clients = new Map();
const cleanup = new Map();
let port;
let connectionError = '';
const initialized = permissions.initializePermissions();
const updater = createBundleUpdater({
  busy: () => running.size > 0 || hasDebuggerConnections(), beforeReload: stopDebugging,
});

async function connect() {
  await initialized;
  if (port) return;
  const next = chrome.runtime.connectNative(HOST);
  port = next;
  connectionError = '';
  next.onMessage.addListener((message) => { void handleRequest(next, message); });
  next.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    if (port !== next) return;
    port = undefined;
    connectionError = reason ? t('enableInRemoteAi')
      : t('connectionLost');
    for (const controller of running.values()) controller.abort();
    void stopDebugging();
    chrome.alarms.create('reconnect', { delayInMinutes: 0.5 });
  });
  const { profileName = 'Chrome' } = await chrome.storage.local.get('profileName');
  if (port === next) {
    try { next.postMessage({ type: 'ready', name: profileName }); }
    catch { connectionError = t('connectionLost'); }
  }
}

async function handleRequest(source, message) {
  if (port !== source) return;
  if (message.type === 'cancel') { running.get(message.id)?.abort(); return; }
  if (!/^[a-f0-9]{64}$/.test(message.clientId)) return;
  const owner = connectionOwner(message);
  if (message.type === 'client-disconnected') {
    for (const [id, client] of clients) {
      if (client === owner) running.get(id)?.abort();
    }
    const closing = finishClientConnections(owner);
    cleanup.set(owner, closing);
    await closing;
    if (cleanup.get(owner) === closing) cleanup.delete(owner);
    return;
  }
  if (typeof message.id !== 'string' || !/^[a-f0-9]{64}$/.test(message.clientId) || running.has(message.id)) return;
  const controller = new AbortController();
  running.set(message.id, controller);
  clients.set(message.id, owner);
  let reply;
  try {
    await cleanup.get(owner);
    if (updater.isReloading()) throw new Error(t('assistantUpdating'));
    const result = await execute({ clientId: message.clientId, sessionId: message.sessionId,
      signal: controller.signal }, message.request);
    reply = { result, error: null };
  } catch (error) {
    reply = { result: null, error: error instanceof Error ? error.message : t('browserActionFailed') };
  } finally {
    running.delete(message.id);
    clients.delete(message.id);
  }
  // A cancelled Chrome connection has no recipient; do not reconnect and replay a completed action.
  if (port === source) {
    try { source.postMessage({ type: 'reply', id: message.id, ...reply }); }
    catch { connectionError = t('connectionLost'); }
  }
}

async function localMessage(message) {
  await initialized;
  switch (message.operation) {
    case 'status': return { connected: Boolean(port), connectionError, ...(await permissions.status()) };
    case 'connect': await connect(); return {};
    case 'pause':
      await permissions.setPaused(message.paused);
      if (message.paused) {
        for (const controller of running.values()) controller.abort();
        await stopDebugging();
      }
      return {};
    case 'revoke':
      // Stop all in-flight actions before removing a site's grant, including queued actions.
      for (const controller of running.values()) controller.abort();
      await permissions.revoke(message.origin);
      await stopDebugging();
      return {};
    case 'siteAccess':
      if (typeof message.allowAll !== 'boolean') throw new Error(t('invalidSiteAccessSetting'));
      for (const controller of running.values()) controller.abort();
      await permissions.setSiteAccessMode(message.allowAll);
      await stopDebugging();
      return {};
    case 'request': return permissions.accessRequest(message.id);
    case 'decide': await permissions.decideAccess(message.id, message.decision); return {};
    case 'profileName':
      if (typeof message.name !== 'string' || message.name.length > 60) throw new Error(t('nameTooLong'));
      await chrome.storage.local.set({ profileName: message.name.trim() || 'Chrome' });
      port?.postMessage({ type: 'ready', name: message.name.trim() || 'Chrome' });
      return {};
    default: throw new Error(t('invalidRequest'));
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Page scripts and content scripts must never grant themselves website permission.
  const allowedPages = ['popup.html', 'approval.html'].map((page) => chrome.runtime.getURL(page));
  if (sender.id !== chrome.runtime.id || !allowedPages.some((page) => sender.url?.split('?')[0] === page)) return false;
  localMessage(message).then((result) => respond({ result })).catch((error) => respond({ error: error.message }));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading' && !change.url) return;
  invalidate(tabId);
  void clearControlledTabs(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  invalidate(tabId);
  void debuggerDetached({ tabId });
  void clearControlledTabs(tabId);
  void forgetWorkTab(tabId).catch(() => console.warn(t('closedTabCleanupFailed')));
});
chrome.debugger.onDetach.addListener((target, reason) => {
  void debuggerDetached(target);
  if (reason !== 'canceled_by_user') return;
  // Chrome's Cancel button is a stop decision, including between tool calls.
  for (const controller of running.values()) controller.abort();
  void permissions.setPaused(true);
  void stopDebugging();
});
chrome.windows.onRemoved.addListener(permissions.windowClosed);
chrome.permissions.onRemoved.addListener(({ origins }) => {
  if (!origins?.length) return;
  for (const controller of running.values()) controller.abort();
  void stopDebugging();
});
chrome.runtime.onInstalled.addListener(() => { void connect(); });
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect') void connect();
  if (alarm.name === UPDATE_ALARM) void updater.check();
});
updater.start();
// Embedded hosts dock the manifest panel themselves and may not expose Chrome's sidePanel API.
if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => console.warn(t('sidePanelEnableFailed')));
}
void renameWorkGroups().catch(() => console.warn(t('tabGroupRenameFailed')));
void connect();
