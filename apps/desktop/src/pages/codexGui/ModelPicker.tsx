import { ModelPicker as SharedModelPicker, type ModelPickerProps } from '../../../../../shared/conversation/ModelPicker';
import { GuiSpeedButton } from './GuiSpeedButton';

export function ModelPicker(props: ModelPickerProps) {
  return <SharedModelPicker {...props} renderSpeed={active => <GuiSpeedButton active={active} />} />;
}
