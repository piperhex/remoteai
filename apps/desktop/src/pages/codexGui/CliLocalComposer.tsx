import { useContext } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { isDesktopApp } from '../../api/backend';
import { CliComposer, type CliComposerProps } from '../../../../../shared/cli-gui/CliComposer';
import { useCliGui } from '../../../../../shared/cli-gui/context';
import { DesktopUsageContext } from '../../../../../shared/chat/DesktopUsageContext';
import { UsageStatus } from './UsageStatus';
import { ConversationTokenStatus } from './ConversationTokenStatus';
import inputStyles from './SkillInput.module.less';
import modeStyles from './AccessPicker.module.less';
import addStyles from './ComposerAddMenu.module.less';
import submitStyles from './ComposerSubmit.module.less';

export function CliLocalComposer(props: CliComposerProps) {
  const cli = useCliGui()!;
  const usage = useContext(DesktopUsageContext);
  return <CliComposer {...props} local={{ inputClassName: inputStyles.editor,
    submitClassName: submitStyles.button,
    modeClasses: { trigger: modeStyles.trigger, panel: modeStyles.panel, heading: modeStyles.heading,
      option: modeStyles.option, copy: modeStyles.copy, check: modeStyles.check },
    addClasses: { trigger: addStyles.trigger, panel: addStyles.panel, heading: addStyles.heading,
      option: addStyles.option },
    status: <UsageStatus active={props.active ?? true} threadId={null} />,
    footer: <ConversationTokenStatus threadId={cli.state.selected?.id ?? null} active={false} usage={usage.usage} />,
    chooseFiles: async directory => {
      if (!isDesktopApp) return [];
      const result = await open({ directory, multiple: true });
      return result ? typeof result === 'string' ? [result] : result : [];
    },
  }} />;
}
