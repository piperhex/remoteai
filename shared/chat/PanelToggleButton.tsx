import type { ReactNode } from 'react';
import { Button, Tooltip, theme } from 'antd';
import './workspaceToolbar.css';

interface Props {
  label: string;
  icon: ReactNode;
  expanded: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** Keep retained panel activity distinct from whether its contents are currently visible. */
export function PanelToggleButton({ label, icon, expanded, active = expanded, disabled, onClick }: Props) {
  const { token } = theme.useToken();
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={icon} aria-label={label} aria-expanded={expanded}
      disabled={disabled} onClick={onClick}
      style={{ color: active ? token.colorSuccessText : undefined, backgroundColor: 'transparent' }} />
  </Tooltip>;
}
