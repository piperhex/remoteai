import { Card, Form, InputNumber, Switch, Typography } from 'antd';
import { CHAT_POLICY_FIELDS } from '../../../../shared/remote-chat/policy';
import { POLICY_SECTIONS, type PolicyField } from './chatPolicyFields';
import { TitleSettingsFields } from './TitleSettingsFields';

function SettingField({ field, language }: { field: PolicyField; language: 0 | 1 }) {
  const { min, max } = CHAT_POLICY_FIELDS[field.key];
  const unlimited = min === -1;
  const toggle = field.key === 'fileBulkEnabled';
  const numericMessage = max === undefined
    ? (language === 0 ? `请输入不小于 ${min} 的整数` : `Enter a whole number of at least ${min}`)
    : (language === 0 ? `请输入 ${min}–${max} 之间的整数` : `Enter a whole number from ${min} to ${max}`);
  const unlimitedMessage = language === 0
    ? '请输入 -1（不限）或正整数' : 'Enter -1 (unlimited) or a positive whole number';
  const message = unlimited ? unlimitedMessage : numericMessage;
  return <div className="chat-policy-field">
    <div className="chat-policy-field-copy">
      <label htmlFor={field.key}>{field.label[language]}</label>
      <Typography.Text type="secondary">{field.hint[language]}</Typography.Text>
    </div>
    <Form.Item name={field.key}
      getValueProps={toggle ? (value: number) => ({ checked: value === 1 }) : undefined}
      getValueFromEvent={toggle ? (checked: boolean) => Number(checked) : undefined}
      rules={[{ required: true, type: 'integer', min, max, message },
      { validator: (_, value: unknown) => unlimited && value === 0
        ? Promise.reject(new Error(message)) : Promise.resolve() }]}>
      {toggle ? <Switch id={field.key} aria-label={field.label[language]} />
        : <InputNumber id={field.key} aria-label={field.label[language]} min={min} max={max}
          precision={0} addonAfter={field.unit[language]} controls={false} />}
    </Form.Item>
  </div>;
}
export function ChatSettingsFields({ zh, loading }: { zh: boolean; loading: boolean }) {
  const language = zh ? 0 : 1;
  return <div className="chat-policy-grid">
    <TitleSettingsFields zh={zh} loading={loading} />
    {POLICY_SECTIONS.map((section) => <Card key={section.key} loading={loading}
      className={'chat-policy-section chat-policy-' + section.key}>
      <div className="chat-policy-section-heading">
        <Typography.Title level={4}>{section.title[language]}</Typography.Title>
        <Typography.Text type="secondary">{section.hint[language]}</Typography.Text>
      </div>
      <div className="chat-policy-section-fields">
        {section.fields.map((field) => <SettingField key={field.key} field={field} language={language} />)}
      </div>
    </Card>)}
  </div>;
}
