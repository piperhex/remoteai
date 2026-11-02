import { createContext } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { invoke } from '../../../api/backend';
import { guiApi } from '../api';
import { browserEvent, type BrowserClient } from '../../../../../../shared/browser/automation';

export const localBrowserClient: BrowserClient = {
  native: isTauri(),
  request: request => invoke('codex_gui_browser', { request }),
  subscribe: callback => guiApi.subscribe(event => { const browser = browserEvent(event); if (browser) callback(browser); }),
};
export const BrowserClientContext = createContext(localBrowserClient);
