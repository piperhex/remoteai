import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button, Select, Tag, Tooltip } from "antd";
import { RotateCcw } from "lucide-react";
import { ConfigFieldInput } from "./ConfigFieldInput";
import { ConfigFieldObject } from "./ConfigFieldObject";
import { ConfigFieldArray } from "./ConfigFieldArray";
import { fieldHelp, fieldLabel, optionLabel, TYPE_LABELS } from "./labels";
import { initialValue, schemaType, schemaVariants, variantIndex } from "./schema";
import type { ConfigCommit, ConfigSchema, ConfigValue } from "./schema";
import styles from "./formStyles.module.less";

export interface ConfigFieldProps {
  fieldKey: string;
  path: string[];
  schema: ConfigSchema;
  value?: ConfigValue;
  disabled?: boolean;
  query?: string;
  label?: string;
  onCommit: ConfigCommit;
}

function VariantSelector(props: ConfigFieldProps & { variants: ConfigSchema[]; selected: number }) {
  const { path, disabled, onCommit, variants, selected } = props;
  const [pending, setPending] = useState(false);
  const options = variants.map((variant, index) => {
    const type = schemaType(variant);
    const discriminator = variant.properties?.type?.enum?.[0];
    const keys = Object.keys(variant.properties ?? {});
    let label = TYPE_LABELS[type] ?? type;
    if (discriminator) label = optionLabel(String(discriminator));
    else if (variant.enum?.length === 1) label = optionLabel(String(variant.enum[0]));
    else if (type === "object" && keys.length === 1) label = fieldLabel(keys[0]);
    return { value: index, label };
  });
  return <Select className={styles.variantSelect} aria-label={uiText("client.configEditor.configurationMethod")} value={selected}
    options={options} disabled={disabled || pending} onChange={(index: number) => {
      setPending(true);
      void onCommit(path, initialValue(variants[index])).finally(() => setPending(false));
    }} />;
}

function FieldHeading(props: ConfigFieldProps & { reset: () => void }) {
  const { fieldKey, label, value, disabled, reset, path } = props;
  const title = label ?? fieldLabel(fieldKey);
  const arrayItem = path.length > 1 && /^\d+$/.test(path[path.length - 1]) && label !== undefined;
  const resetLabel = arrayItem ? uiText("client.configEditor.delete", { value1: title }) : uiText("client.configEditor.reset", { value1: title });
  const help = fieldHelp(fieldKey);
  return <div className={styles.fieldHeading}>
    <div className={styles.fieldCopy}>
      <div className={styles.fieldTitle}><span>{title}</span>
        {value !== undefined && <Tag bordered={false} className={styles.configuredTag}>{uiText("client.configEditor.configured")}</Tag>}
      </div>
      <code>{fieldKey}</code>
      {help && <p>{help}</p>}
    </div>
    {value !== undefined && <Tooltip title={arrayItem ? uiText("client.configEditor.deleteThisItem") : uiText("client.configEditor.clearThisItemAndUseTheDefault")}
      styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" className={styles.resetButton} aria-label={resetLabel} disabled={disabled}
        icon={<RotateCcw size={18} />} onClick={reset} />
    </Tooltip>}
  </div>;
}

function FieldControl(props: ConfigFieldProps & { resolved: ConfigSchema }) {
  const { fieldKey, path, resolved, value, disabled, onCommit, label } = props;
  const type = schemaType(resolved, value);
  if (type === "object") return <ConfigFieldObject {...props} schema={resolved} />;
  if (type === "array") return <ConfigFieldArray {...props} schema={resolved} />;
  return <ConfigFieldInput schema={resolved} fieldKey={fieldKey} value={value}
    disabled={disabled} label={label ?? fieldLabel(fieldKey)} onCommit={(next) => onCommit(path, next)} />;
}

export function ConfigField(props: ConfigFieldProps) {
  const [resetVersion, setResetVersion] = useState(0);
  const variants = schemaVariants(props.schema);
  const selected = variantIndex(variants, props.value);
  const resolved = variants[selected] ?? {};
  const type = schemaType(resolved, props.value);
  const complex = type === "object" || type === "array";
  const reset = () => {
    void props.onCommit(props.path, null).then((success) => {
      if (success) setResetVersion((version) => version + 1);
    });
  };
  return <section className={`${styles.field} ${complex ? styles.complexField : ""}`}>
    <FieldHeading {...props} reset={reset} />
    <div className={styles.fieldControl}>
      {variants.length > 1 && <VariantSelector {...props} variants={variants} selected={selected} />}
      <FieldControl key={resetVersion} {...props} resolved={resolved} />
    </div>
  </section>;
}
