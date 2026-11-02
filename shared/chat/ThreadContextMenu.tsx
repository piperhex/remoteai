import { Dropdown, type DropdownProps } from 'antd';
import { cloneElement, type HTMLAttributes, type ReactElement } from 'react';
import { useThreadLongPress } from './useThreadLongPress';
import styles from './ThreadContextMenu.module.less';
import { useGroupMenu } from './groups/useGroupMenu';
import type { GroupTarget } from './groups/model';

/** Route mouse, touch and keyboard gestures through the same viewport-aware context menu. */
export function ThreadContextMenu({ children, overlayClassName = '', groupTarget, ...props }: Omit<DropdownProps,
  'children' | 'trigger'> & { children: ReactElement<HTMLAttributes<HTMLElement>>; groupTarget?: GroupTarget }) {
  const groupItems = useGroupMenu(groupTarget);
  const gestures = useThreadLongPress(({ target, x, y }) => {
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    }));
  }, { enabled: !props.disabled, nativeContextMenu: true });
  return <Dropdown autoFocus {...props} trigger={['contextMenu']}
    menu={{ ...props.menu, items: [...(props.menu?.items ?? []), ...groupItems] }}
    overlayStyle={{ ...props.overlayStyle, maxWidth: 400 }}
    overlayClassName={`${styles.menu} ${overlayClassName}`}>
    {cloneElement(children, { ...gestures, className: `${children.props.className ?? ''} ${styles.trigger}` })}
  </Dropdown>;
}
