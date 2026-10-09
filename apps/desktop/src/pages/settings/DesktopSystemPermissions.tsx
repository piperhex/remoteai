import { Alert, Button, Space, Typography } from 'antd';
import { useDesktopSystemPermissions } from './useDesktopSystemPermissions';
import type { ComputerUsePermission } from '../../api/computerUse';

const PERMISSIONS: { key: ComputerUsePermission; title: string; description: string }[] = [
  { key: 'screenRecording', title: '屏幕录制', description: '让其他设备看到这台 Mac 的画面。' },
  { key: 'accessibility', title: '辅助功能', description: '允许远程操作鼠标和键盘。' },
];

export function DesktopSystemPermissions({ active }: { active: boolean }) {
  const { permissions, error, busy, request } = useDesktopSystemPermissions(active);
  if (!permissions) return null;
  return <Space direction="vertical" style={{ width: '100%', maxWidth: 400 }}>
    <Typography.Text strong>Mac 访问权限</Typography.Text>
    {PERMISSIONS.map(({ key, title, description }) => <div key={key}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>{title}<div><Typography.Text type="secondary">{description}</Typography.Text></div></div>
      {permissions[key] ? <span style={{ flexShrink: 0 }}>已开启</span>
        : <Button disabled={busy} onClick={() => void request(key)} aria-label={`开启${title}`}>去开启</Button>}
    </div>)}
    <Typography.Text type="secondary">请为 Remote AI 开启权限后重新连接；若系统提示退出，请重启应用。</Typography.Text>
    <Typography.Text type="secondary">Mac 暂不支持传输电脑声音，连接时请保持登录并打开应用。</Typography.Text>
    {!!error && <Alert type="error" message={error} />}
  </Space>;
}
