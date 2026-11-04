import { displayError } from '../../../../../shared/localization/uiText';
import { guiApi } from '../../../../../shared/conversation/api';

import { projectFileReference, useProjectFileCandidates,
  type ProjectFileSearch } from '../../../../../shared/chat/useProjectFileCandidates';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';
import type { ComposerOption } from './composerOptions';

const load: ProjectFileSearch = request => guiApi.request({ operation: 'projectFiles', ...request });

export function useComposerFileOptions(options: {
  active: boolean; connected: boolean; cwd: string; query: string;
  choose?: (reference: AttachmentReference) => void;
}) {
  const result = useProjectFileCandidates({ ...options, load });
  const items: ComposerOption[] = result.entries.map(file => ({ kind: 'file', key: file.path,
    label: file.name, description: file.relativePath ?? file.path, directory: file.directory,
    enabled: options.connected, command: { enabled: options.connected,
      run: () => options.choose?.(projectFileReference(file)) } }));
  return { ...result, error: result.error ? displayError(result.error) : '', options: items };
}
