import type { ProjectDirectoriesResponse } from '../../../../../shared/remote-chat/projectDirectories';
import type { EntryChange, EntryRequest } from '../../../../../shared/project-browser/entryActions';
import { guiApi } from '../../../../../shared/conversation/api';

export const loadProjectExplorer = (directory: string, includeFiles = false) =>
  guiApi.request<ProjectDirectoriesResponse>({ operation: 'projectDirectories', directory, includeFiles });
export const mutateProjectExplorer = (request: EntryRequest) =>
  guiApi.request<EntryChange>({ operation: 'projectEntryAction', ...request });
