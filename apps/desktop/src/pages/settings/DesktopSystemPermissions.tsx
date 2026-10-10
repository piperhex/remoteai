import { Alert, Button, Popconfirm, Space, Typography } from 'antd';
import { useDesktopSystemPermissions } from './useDesktopSystemPermissions';
import type { ComputerUsePermission } from '../../api/computerUse';

const PERMISSIONS: { key: ComputerUsePermission; title: string; description: string }[] = [
  { key: 'screenRecording', title: '屏幕录制', description: '让其他设备看到这台 Mac 的画面。' },
  { key: 'accessibility', title: '辅助功能', description: '允许远程操作鼠标和键盘。' },
];

export function DesktopSystemPermissions({ active }: { active: boolean }) {
  const { permissions, error, busy, request, repair, restart } = useDesktopSystemPermissions(active);
  if (!permissions) return null;
  const needsRestart = !!permissions.restartRequired?.length;
  return <Space direction="vertical" style={{ width: '100%', maxWidth: 400 }}>
    <Typography.Text strong>Mac 访问权限</Typography.Text>
    {PERMISSIONS.map(({ key, title, description }) => {
      const repaired = permissions.restartRequired?.includes(key);
      return <div key={key}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>{title}<div><Typography.Text type="secondary">{description}</Typography.Text></div></div>
          {permissions[key] ? <span style={{ flexShrink: 0 }}>已开启</span>
            : <Button disabled={busy || !active} onClick={() => void request(key)}
              aria-label={`开启${title}`}>去开启</Button>}
        </div>
        {repaired ? <Typography.Text type="secondary">重新授权后请重启应用</Typography.Text>
          : <Popconfirm title={`修复${title}权限？`} open={active ? undefined : false}
            description={`将清除 Remote AI 的${title}授权，相关远程操作可能中断。请重新授权后重启应用。`}
            okText="重置并去授权" cancelText="取消" disabled={busy || !active}
            styles={{ root: { maxWidth: 400 } }}
            onConfirm={() => repair(key)}>
            <Button type="link" size="small" disabled={busy || !active}
              aria-label={`修复${title}权限`} style={{ paddingInline: 0 }}>已开启仍无法使用？修复权限</Button>
          </Popconfirm>}
      </div>;
    })}
    {needsRestart && <Alert type="info" showIcon message="权限已重置，请重新授权"
      description={<Space direction="vertical" size={8}>
        <span>请在系统设置中为 Remote AI 重新开启对应权限。完成后保存工作并重启应用，再连接远程桌面。</span>
        <Button disabled={busy || !active} onClick={() => void restart()}>完成授权后重启</Button>
      </Space>} />}
    <Typography.Text type="secondary">请为 Remote AI 开启权限后重新连接；若系统提示退出，请重启应用。</Typography.Text>
    <Typography.Text type="secondary">
      更新或改名后无法连接，可尝试修复权限；若系统仍显示旧名称，请移除旧条目并重新添加当前应用。
    </Typography.Text>
    <Typography.Text type="secondary">Mac 暂不支持传输电脑声音，连接时请保持登录并打开应用。</Typography.Text>
    {!!error && <Alert type="error" message={error} />}
  </Space>;
}
