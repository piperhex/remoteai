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

/** Keep panel visibility feedback consistent across local, remote and web workspaces. */
export function PanelToggleButton({ label, icon, expanded, active = expanded, disabled, onClick }: Props) {
  const { token } = theme.useToken();
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={icon} aria-label={label} aria-expanded={expanded}
      disabled={disabled} onClick={onClick} style={active ? {
        color: token.colorSuccessText, backgroundColor: token.colorSuccessBg,
      } : undefined} />
  </Tooltip>;
}
