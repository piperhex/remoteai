import { displayError } from '../../../../../shared/localization/uiText';
import type { RefObject } from 'react';
import { isDesktopApp } from '../../api/backend';
import { uiText } from "../../../../../shared/localization/uiText";
import { fileDropError, useFileDrop } from '../../../../../shared/chat/useFileDrop';
import { guiApi } from '../../../../../shared/conversation/api';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';
import { droppedReferences, subscribeFileDrop } from './fileDrop';
import { projectName, saveProject } from '../../../../../shared/conversation/projectCatalog';

interface Options {
  target: RefObject<HTMLElement>;
  selected: string | null;
  active: boolean;
  disabled: boolean;
  addAttachments: (references: AttachmentReference[]) => void;
  addImages: (files: File[]) => void;
  setProject: (path: string) => void;
  report: (error: unknown) => void;
  focus: () => void;
}

async function selectProject(options: Options, folders: AttachmentReference[], current: () => boolean) {
  if (!folders.length) return true;
  if (folders.length !== 1) {
    options.report(uiText("client.composer.pleaseDropOneFolderAtATime"));
    return false;
  }
  let directory: string;
  try {
    ({ directory } = await guiApi.request<{ directory: string }>({
      operation: 'projectDirectories', directory: folders[0].path,
    }));
  } catch {
    if (current()) options.report(uiText("client.composer.thisFolderIsUnavailablePleaseChooseAnAccessibleFolder"));
    return false;
  }
  if (!current()) return false;
  try { saveProject({ path: directory, name: projectName(directory) }); }
  catch { options.report(uiText("client.conversation.couldNotSaveTheProjectPleaseTryAgain")); return false; }
  options.setProject(directory);
  return true;
}

/** One native drop consumes one host grant, including both project selection and attachments. */
export function useComposerDrop(options: Options) {
  return useFileDrop({ target: options.target, scope: options.selected ?? 'new',
    active: options.active, disabled: options.disabled,
    subscribe: isDesktopApp ? subscribeFileDrop : undefined,
    addPaths: async (paths, current) => {
      const references = await droppedReferences(paths);
      if (!current()) return;
      const folders = references.filter(reference => reference.kind === 'folder');
      if (!options.selected && !await selectProject(options, folders, current)) return;
      if (!current()) return;
      const attachments = options.selected ? references : references.filter(reference => reference.kind !== 'folder');
      options.addAttachments(attachments);
      options.focus();
    },
    addFiles: files => {
      const images = files.filter(file => file.type.startsWith('image/'));
      if (images.length) options.addImages(images);
      if (images.length !== files.length) options.report(uiText("client.workspaceActions.useAddFileToSelectTheseFiles"));
    },
    report: error => options.report(displayError(fileDropError(error))),
  });
}
