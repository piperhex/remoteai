import { uiText } from "../../../../../shared/localization/uiText";
import { Button, Tooltip } from "antd";
import { Maximize, Minimize } from "lucide-react";

export interface GuiFocusMode {
  focused: boolean;
  onToggleFocus: () => void;
}

export function FocusModeButton({ focused, onToggleFocus }: GuiFocusMode) {
  const label = focused ? uiText("client.composer.exitFocusMode") : uiText("client.composer.enterFocusMode");
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" size="small" aria-label={label} aria-pressed={focused} onClick={onToggleFocus}
      icon={focused ? <Minimize size={15} /> : <Maximize size={15} />} />
  </Tooltip>;
}
