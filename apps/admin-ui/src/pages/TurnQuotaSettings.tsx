import { useEffect, useRef } from 'react';
import { Alert, Button, Card, Form, InputNumber, Space, Tag, Typography } from 'antd';
import { turnQuotaCopy } from '@remoteai/i18n/copy/admin/turnQuota';
import { useI18n } from '../i18n-context';
import { useTurnQuota, type TurnQuotaProps } from './useTurnQuota';

export function TurnQuotaSettings({ api, canManage }: TurnQuotaProps) {
  const { language } = useI18n();
  const copy = turnQuotaCopy[language];
  const { status, error, busy, load, save, retry } = useTurnQuota(api);
  const [form] = Form.useForm<{ totalQuota: number }>();
  const initialized = useRef(false);
  useEffect(() => {
    if (status && !initialized.current) {
      form.setFieldsValue({ totalQuota: status.totalQuota });
      initialized.current = true;
    }
  }, [form, status]);
  const issue = status?.issue;
  const explanation = issue === 'not_configured' ? copy.notConfigured
    : issue === 'restart_snapshot_failed' ? copy.snapshotFailed
      : issue ? copy.unavailable : copy.pendingHint;
  return <Card title={copy.title} style={{ marginBottom: 24 }} data-testid="turn-quota-settings">
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph style={{ marginBottom: 0 }}>{copy.scope}</Typography.Paragraph>
      <Typography.Text type="secondary">{copy.capacity}</Typography.Text>
      <Typography.Text type="secondary">{copy.timing}</Typography.Text>
      {error && <Alert type="error" showIcon message={copy[error]} />}
      {status && <>
        <Space wrap>
          <Typography.Text>{copy.saved}: {status.totalQuota}</Typography.Text>
          <Typography.Text>
            {copy.running}: {error ? copy.unknown : (status.appliedQuota ?? copy.unknown)}
          </Typography.Text>
          <Tag color={status.state === 'applied' && !error ? 'success' : 'warning'}>
            {status.state === 'applied' && !error ? copy.applied : copy.pending}
          </Tag>
        </Space>
        {status.state !== 'applied' && <Alert type="warning" showIcon message={explanation} />}
      </>}
      <Form form={form} layout="vertical" onFinish={({ totalQuota }) => save(totalQuota)}
        disabled={!canManage || busy || !status}>
        <Form.Item name="totalQuota" label={copy.label} rules={[
          { required: true, type: 'integer', min: 1, max: 65535, message: copy.validation },
        ]}>
          <InputNumber id="turn-total-quota" controls={false} style={{ width: '100%', maxWidth: 240 }} />
        </Form.Item>
        <Space wrap>
          {canManage && <Button type="primary" htmlType="submit" loading={busy}>{copy.save}</Button>}
          {canManage && status?.state === 'pending' &&
            <Button onClick={() => void retry()} loading={busy}>{copy.retry}</Button>}
          <Button disabled={busy} onClick={() => { initialized.current = false; void load(); }}>{copy.reload}</Button>
        </Space>
      </Form>
    </Space>
  </Card>;
}
