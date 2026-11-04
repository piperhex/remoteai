import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button, Collapse, Empty, Input, Select } from "antd";
import { Plus } from "lucide-react";
import { ConfigField, type ConfigFieldProps } from "./ConfigField";
import { fieldLabel, TYPE_LABELS } from "./labels";
import { childSchema, initialValue, matchesSearch, objectValue } from "./schema";
import type { ConfigSchema, ConfigValue } from "./schema";
import styles from "./formStyles.module.less";

interface AddPropertyProps {
  schema: ConfigSchema;
  existing: string[];
  disabled?: boolean;
  onAdd: (key: string, value: ConfigValue) => Promise<boolean>;
}

export function ConfigFieldAddProperty({ schema, existing, disabled, onAdd }: AddPropertyProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("string");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const typed = typeof schema.additionalProperties === "object";
  const add = async () => {
    const key = name.trim();
    if (!key || pending || disabled) return;
    if (existing.includes(key)) { setError(uiText("client.configEditor.thisNameAlreadyExistsChooseAnotherName")); return; }
    setPending(true);
    const itemSchema = typed ? schema.additionalProperties as ConfigSchema : { type };
    const success = await onAdd(key, initialValue(itemSchema));
    setPending(false);
    if (!success) { setError(uiText("client.configEditor.couldNotAddTheItemCheckTheMessageAndTry")); return; }
    setName("");
    setAdding(false);
    setError(undefined);
  };
  if (!adding) return <Button type="dashed" size="small" disabled={disabled} icon={<Plus size={14} />}
    onClick={() => setAdding(true)}>{uiText("client.configEditor.addSetting")}</Button>;
  return <div className={styles.addProperty}>
    {!typed && <Select aria-label={uiText("client.configEditor.newSettingType")} value={type} disabled={disabled || pending}
      options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} onChange={setType} />}
    <Input aria-label={uiText("client.configEditor.newSettingName")} placeholder={uiText("client.configEditor.enterANameThenLeaveTheFieldToAddIt")} value={name}
      disabled={disabled || pending} status={error ? "error" : undefined}
      onChange={(event) => { setName(event.target.value); setError(undefined); }}
      onPressEnter={(event) => event.currentTarget.blur()} onBlur={() => { void add(); }} />
    <Button type="text" size="small" disabled={pending} onMouseDown={(event) => event.preventDefault()}
      onClick={() => { setAdding(false); setName(""); setError(undefined); }}>{uiText("client.accounts.cancel")}</Button>
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </div>;
}

function ObjectFields(props: ConfigFieldProps) {
  const { schema, path, value, query = "", disabled, onCommit, fieldKey } = props;
  const values = objectValue(value);
  const properties = schema.properties ?? {};
  const keys = [...new Set([...Object.keys(properties), ...Object.keys(values)])];
  const selfMatches = `${fieldLabel(fieldKey)} ${fieldKey}`.toLowerCase().includes(query);
  const nestedQuery = selfMatches ? "" : query;
  const visible = keys.filter((key) => matchesSearch({
    key, schema: childSchema(schema, key, values[key]), value: values[key], query: nestedQuery,
  }));
  return <div className={styles.objectFields}>
    {visible.map((key) => <ConfigField key={key} fieldKey={key} path={[...path, key]}
      schema={childSchema(schema, key, values[key])} value={values[key]} query={nestedQuery}
      disabled={disabled} onCommit={onCommit} />)}
    {!keys.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("client.configEditor.noSettingsAddedYet")} />}
    {schema.additionalProperties !== false && <div className={styles.addRow}>
      <ConfigFieldAddProperty schema={schema} existing={keys} disabled={disabled}
        onAdd={(key, next) => onCommit([...path, key], next)} />
    </div>}
  </div>;
}

export function ConfigFieldObject(props: ConfigFieldProps) {
  const values = objectValue(props.value);
  const count = Object.keys(values).length;
  const [open, setOpen] = useState(false);
  const searching = Boolean(props.query);
  return <Collapse className={styles.objectCollapse} activeKey={open || searching ? ["fields"] : []}
    onChange={(keys) => setOpen(keys.includes("fields"))} items={[{
      key: "fields", label: count ? uiText("client.configEditor.configuredExpandToEdit", { value1: count }) : uiText("client.configEditor.expandConfigurationOptions"),
      children: <ObjectFields {...props} />,
    }]} />;
}
