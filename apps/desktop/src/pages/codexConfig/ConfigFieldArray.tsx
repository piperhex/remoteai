import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState } from "react";
import { Button, Empty, Select } from "antd";
import { Plus } from "lucide-react";
import { ConfigField, type ConfigFieldProps } from "./ConfigField";
import { initialValue } from "./schema";
import { ConfigArrayWriteQueue } from "./schemaArrayWriteQueue";
import { TYPE_LABELS } from "./labels";
import type { ConfigValue } from "./schema";
import styles from "./formStyles.module.less";

export function ConfigFieldArray(props: ConfigFieldProps) {
  const { value, schema, path, disabled, onCommit } = props;
  const items = Array.isArray(value) ? value : [];
  const [itemType, setItemType] = useState("string");
  const itemSchema = schema.items ?? {};
  const untyped = !Object.keys(itemSchema).length;
  const queue = useRef(new ConfigArrayWriteQueue(items));
  const [rows, setRows] = useState(queue.current.rows);
  useEffect(() => {
    if (queue.current.synchronize(Array.isArray(value) ? value : [])) setRows(queue.current.rows);
  }, [value]);
  const save = (next: ConfigValue[]) => onCommit(path, next);
  const showResult = async (operation: Promise<boolean>) => {
    const success = await operation;
    setRows(queue.current.rows);
    return success;
  };
  return <div className={styles.arrayFields}>
    {rows.map((row, index) => <ConfigField key={row.id} fieldKey={String(index + 1)} label={uiText("client.configEditor.item", { value1: index + 1 })}
      path={[...path, String(index)]} schema={itemSchema} value={row.value} disabled={disabled}
      onCommit={(childPath, replacement) => showResult(queue.current.edit({
        id: row.id, path: childPath.slice(path.length + 1), value: replacement,
      }, save))} />)}
    {!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("client.configEditor.noItemsAddedYet")} />}
    <div className={styles.addRow}>
      {untyped && <Select size="small" aria-label={uiText("client.configEditor.newListItemType")} value={itemType} disabled={disabled}
        className={styles.arrayType} onChange={setItemType}
        options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />}
      <Button type="dashed" size="small" icon={<Plus size={14} />} disabled={disabled} onClick={() => {
        void showResult(queue.current.append(initialValue(untyped ? { type: itemType } : itemSchema), save));
      }}>
      {uiText("client.configEditor.addItem")}</Button></div>
  </div>;
}
