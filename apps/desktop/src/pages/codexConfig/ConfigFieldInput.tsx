import { uiText } from "../../../../../shared/localization/uiText";
import { useContext, useEffect, useRef, useState } from "react";
import { AutoComplete, Input, Select, Spin } from "antd";
import { ChevronDown } from "lucide-react";
import { optionLabel, stringSuggestions } from "./labels";
import { schemaType, type ConfigSchema, type ConfigValue } from "./schema";
import { ConfigModelsContext } from "./useConfigModels";
import styles from "./formStyles.module.less";

interface ConfigFieldInputProps {
  schema: ConfigSchema;
  value?: ConfigValue;
  fieldKey: string;
  label: string;
  disabled?: boolean;
  onCommit: (value: ConfigValue | null) => Promise<boolean>;
}

function validateNumber(text: string, schema: ConfigSchema): string | undefined {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) return uiText("client.configEditor.enterAValidNumber");
  if (schemaType(schema) === "integer" && !Number.isSafeInteger(value)) return uiText("client.configEditor.enterAnIntegerThatCanBeStoredWithoutLosingPrecision");
  if (schema.minimum !== undefined && value < schema.minimum) return uiText("client.configEditor.mustBeAtLeast", { value1: schema.minimum });
  if (schema.maximum !== undefined && value > schema.maximum) return uiText("client.configEditor.mustBeAtMost", { value1: schema.maximum });
  return undefined;
}

function validateText(value: string, schema: ConfigSchema): string | undefined {
  if (schema.minLength !== undefined && value.length < schema.minLength) return uiText("client.configEditor.enterAtLeastCharacters", { value1: schema.minLength });
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return uiText("client.configEditor.enterNoMoreThanCharacters", { value1: schema.maxLength });
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return uiText("client.configEditor.theValueDoesNotMatchTheRequiredFormatForThis");
  return undefined;
}

function useConfigDraft({ schema, value, disabled, onCommit }: ConfigFieldInputProps) {
  const source = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string>();
  const dirty = useRef(false);
  const latest = useRef(draft);
  const inFlight = useRef<string>();
  const type = schemaType(schema, value);
  const numeric = type === "integer" || type === "number";
  useEffect(() => {
    if (!dirty.current || source === latest.current) {
      setDraft(source);
      latest.current = source;
      dirty.current = false;
    }
  }, [source]);
  const commit = async () => {
    if (!dirty.current || disabled) return;
    const submitted = latest.current;
    if (inFlight.current === submitted) return;
    const validation = numeric ? validateNumber(submitted, schema) : validateText(submitted, schema);
    if (validation && (!numeric || submitted !== "")) { setError(validation); return; }
    const replacement = numeric ? (submitted === "" ? null : Number(submitted)) : submitted;
    inFlight.current = submitted;
    const success = await onCommit(replacement);
    inFlight.current = undefined;
    if (success && latest.current === submitted) dirty.current = false;
    setError(success ? undefined : uiText("client.configEditor.couldNotSaveCheckTheMessageAndTryAgain"));
  };
  const change = (next: string) => {
    dirty.current = true;
    latest.current = next;
    setDraft(next);
    setError(undefined);
  };
  return { draft, error, numeric, change, commit };
}

function DraftInput(props: ConfigFieldInputProps) {
  const { fieldKey, label, value, disabled } = props;
  const { draft, error, numeric, change, commit } = useConfigDraft(props);
  const [search, setSearch] = useState("");
  const modelCatalog = useContext(ConfigModelsContext);
  const shared = {
    value: draft, disabled, "aria-label": label, status: error ? "error" as const : undefined,
    placeholder: value === "" ? uiText("client.configEditor.emptyText") : uiText("client.configEditor.useDefault"), onBlur: () => { void commit(); },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
  };
  const multiline = /instructions|prompt|description/.test(fieldKey) || draft.includes("\n");
  const secret = /(?:^|_)(?:api_key|token|secret|password)$/.test(fieldKey);
  const suggestions = fieldKey === "model" ? modelCatalog.models : stringSuggestions(fieldKey);
  let input = <Input {...shared} inputMode={numeric ? "decimal" : undefined}
    onPressEnter={(event) => event.currentTarget.blur()} />;
  if (multiline) input = <Input.TextArea {...shared} autoSize={{ minRows: 3, maxRows: 10 }} />;
  else if (secret) input = <Input.Password {...shared} autoComplete="off" />;
  else if (fieldKey === "model" || suggestions.length) input = <AutoComplete
    value={draft} disabled={disabled} onChange={change}
    className={styles.select} onSearch={setSearch} onFocus={() => setSearch("")}
    options={suggestions.filter((item) => optionLabel(item).toLowerCase().includes(search.toLowerCase()))
      .map((item) => ({ value: item, label: optionLabel(item) }))}
    onSelect={(next) => { change(next); void commit(); }} onBlur={() => { void commit(); }}>
    <Input aria-label={label} placeholder={uiText("client.configEditor.chooseOrEnterACustomValue")} status={shared.status}
      suffix={fieldKey === "model" && modelCatalog.loading
        ? <Spin size="small" /> : <ChevronDown size={14} aria-hidden="true" />} />
  </AutoComplete>;
  return <div className={styles.inputWrap}>
    {input}
    {error && <span role="alert" className={styles.error}>{error}</span>}
  </div>;
}

function ChoiceInput(props: ConfigFieldInputProps) {
  const { schema, value, label, disabled, onCommit } = props;
  const [pending, setPending] = useState<{ value: string }>();
  const [error, setError] = useState(false);
  const boolean = schemaType(schema, value) === "boolean";
  const options = boolean ? [
    { value: "true", label: uiText("client.configEditor.on") }, { value: "false", label: uiText("client.projectBrowser.close") },
  ] : (schema.enum ?? []).map((item) => ({ value: JSON.stringify(item), label: optionLabel(String(item)) }));
  const selected = value === undefined ? undefined : JSON.stringify(value);
  if (selected !== undefined && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: String(value) });
  }
  const commit = async (next: string | undefined) => {
    setPending({ value: next ?? "" });
    const success = await onCommit(next === undefined ? null : JSON.parse(next) as ConfigValue);
    setPending(undefined);
    setError(!success);
  };
  return <div className={styles.inputWrap}>
    <Select allowClear aria-label={label} placeholder={uiText("client.configEditor.useDefault")} options={options}
      className={styles.select} value={pending ? pending.value || undefined : selected}
      disabled={disabled || pending !== undefined} showSearch optionFilterProp="label"
      onChange={(next: string | undefined) => { void commit(next); }} />
    {error && <span role="alert" className={styles.error}>{uiText("client.configEditor.couldNotSavePleaseTryAgain")}</span>}
  </div>;
}

export function ConfigFieldInput(props: ConfigFieldInputProps) {
  if (props.schema.enum || schemaType(props.schema, props.value) === "boolean") return <ChoiceInput {...props} />;
  return <DraftInput {...props} />;
}
