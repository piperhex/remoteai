import { uiText } from "../../../../../shared/localization/uiText";
import { useMemo, useState } from "react";
import { Empty } from "antd";
import { ConfigField } from "./ConfigField";
import { ConfigFieldAddProperty } from "./ConfigFieldObject";
import { categoryFor, CONFIG_CATEGORIES } from "./labels";
import { childSchema, configSchema, matchesSearch } from "./schema";
import type { ConfigCommit, ConfigValues } from "./schema";
import styles from "./formStyles.module.less";

interface ConfigFormProps {
  values: ConfigValues;
  disabled?: boolean;
  onCommit: ConfigCommit;
  view: { search: string; filter: string; onSearchChange: (value: string) => void };
}

export function ConfigForm({ values, disabled, onCommit, view }: ConfigFormProps) {
  const [category, setCategory] = useState("model");
  const { search, filter, onSearchChange } = view;
  const query = search.trim().toLowerCase();
  const keys = useMemo(() => {
    const known = CONFIG_CATEGORIES.flatMap((item) => item.fields)
      .filter((key) => configSchema.properties?.[key] !== undefined);
    return [...new Set([...known, ...Object.keys(configSchema.properties ?? {}), ...Object.keys(values)])];
  }, [values]);
  const visible = keys.filter((key) => {
    if (filter === "configured" && values[key] === undefined) return false;
    if (!query && categoryFor(key) !== category) return false;
    return matchesSearch({ key, schema: childSchema(configSchema, key, values[key]), value: values[key], query });
  });
  const activeCategory = CONFIG_CATEGORIES.find((item) => item.key === category) ?? CONFIG_CATEGORIES[0];
  return <div className={styles.form}>
    <div className={styles.layout}>
      <nav className={styles.categories} aria-label={uiText("client.configEditor.settingCategories")}>
        {CONFIG_CATEGORIES.map((item) => <button key={item.key} type="button"
          className={!query && category === item.key ? styles.activeCategory : ""}
          onClick={() => { setCategory(item.key); onSearchChange(""); }}>
          <span>{item.label}</span><span className={styles.categoryCount}>
            {keys.filter((key) => categoryFor(key) === item.key).length}
          </span>
        </button>)}
      </nav>
      <div className={styles.content}>
        <div className={styles.sectionHeading}>
          <div><h2>{query ? uiText("client.shared.searchResults") : activeCategory.label}</h2>
            <p>{query ? uiText("client.configEditor.foundGroupsOfRelatedSettings", { value1: visible.length }) : activeCategory.description}</p></div>
          <span className={styles.sectionCount}>{uiText("client.configEditor.total")}{visible.length} {uiText("client.mobile.items")}</span>
        </div>
        <div className={styles.fields}>
          {visible.map((key) => <ConfigField key={key} fieldKey={key} path={[key]}
            schema={childSchema(configSchema, key, values[key])} value={values[key]}
            disabled={disabled} query={query} onCommit={onCommit} />)}
          {!visible.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={filter === "configured" ? uiText("client.configEditor.noCustomSettingsInThisCategoryYet") : uiText("client.configEditor.noMatchingSettings")} />}
        </div>
        {category === "advanced" && !query && <div className={styles.customSection}>
          <h3>{uiText("client.configEditor.customSettings")}</h3><p>{uiText("client.configEditor.addSettingsSupportedByOtherVersions")}</p>
          <ConfigFieldAddProperty schema={{ additionalProperties: true }} existing={keys} disabled={disabled}
            onAdd={(key, value) => onCommit([key], value)} />
        </div>}
      </div>
    </div>
  </div>;
}
