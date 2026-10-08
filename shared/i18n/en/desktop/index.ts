import { usage } from './usage';
import { configEditor } from './configEditor';
import { configLabels } from './configLabels';
import { configHelp } from './configHelp';
import { composer } from './composer';
import { workspaceSettings } from './workspaceSettings';
import { conversation } from './conversation';
import { workspaceActions } from './workspaceActions';
import { scheduledTasks } from './scheduledTasks';

export const desktop = {
  ...usage,
  ...configEditor,
  ...configLabels,
  ...configHelp,
  ...composer,
  ...workspaceSettings,
  ...conversation,
  ...workspaceActions,
  ...scheduledTasks,
};
