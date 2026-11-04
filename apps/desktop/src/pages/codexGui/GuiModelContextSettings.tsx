import { useState } from "react";
import { AutoComplete, Button, Input, Spin } from "antd";
import { uiText } from "../../../../../shared/localization/uiText";
import { CONTEXT_CAPACITY_PRESETS_K, TOKENS_PER_K } from "../../../../../shared/remote-chat/contextSettings";
import { useModelContextSettings } from "./useModelContextSettings";
import styles from "./GuiModelContextSettings.module.less";

const options = CONTEXT_CAPACITY_PRESETS_K.map((value) => ({ value: String(value), label: `${value}K` }));

export function GuiModelContextSettings() {
  const editor = useModelContextSettings();
  const [model, setModel] = useState("");
  const [capacity, setCapacity] = useState("");
  const disabled = editor.loading || editor.saving;
  const add = async () => {
    if (model.trim() && capacity.trim() && await editor.save(model.trim(), capacity)) {
      setModel(""); setCapacity("");
    }
  };
  return <section className={styles.panel} aria-label={uiText("client.guiSettings.defaultContextByModel")}>
    <div className={styles.heading}><h3>{uiText("client.guiSettings.defaultContextByModel")}</h3>
      <Button size="small" disabled={disabled} onClick={() => void editor.load()}>{uiText("client.guiSettings.refreshDefaults")}</Button>
    </div>
    <p>{uiText("client.guiSettings.officialModelsUseAdminDefaultsOtherModelsUseProviderSettings")}</p>
    <p>{uiText("client.guiSettings.changesSaveAutomaticallyAndApplyWhenYouNextSendOr")}</p>
    {editor.loading && <div role="status"><Spin size="small" /> {uiText("client.composer.loadingSettings")}</div>}
    {editor.settings?.usingCachedDefaults && <p role="status" className={styles.notice}>
      {uiText("client.guiSettings.defaultsCouldNotBeRefreshedPreviousSettingsAreRetainedTry")}</p>}
    {editor.error && <div role="alert" className={styles.error}>{editor.error}
      {!editor.settings && <Button size="small" onClick={() => void editor.load()}>{uiText("client.terminal.retry")}</Button>}
    </div>}
    {editor.settings && <>
      <div className={styles.list}>
        {editor.models.map((name) => {
          const inherited = editor.settings!.defaults[name];
          const value = editor.draft[name] ?? "";
          return <div className={styles.row} key={name}>
            <div className={styles.model}><strong>{name}</strong><span>{inherited
              ? uiText("client.guiSettings.defaultK", { value1: inherited / TOKENS_PER_K }) : uiText("client.guiSettings.defaultUseModelCapacity")}</span></div>
            <AutoComplete value={value} options={options} disabled={disabled} className={styles.capacity}
              defaultActiveFirstOption={false} onSelect={(next) => void editor.save(name, next)}
              onChange={(next) => editor.change(name, next)}
              onBlur={() => void editor.save(name, value)}>
              <Input aria-label={uiText("client.guiSettings.contextCapacity", { value1: name })} suffix="K"
                inputMode="decimal" placeholder={inherited ? String(inherited / TOKENS_PER_K) : uiText("client.configHelp.default")}
                onPressEnter={(event) => event.currentTarget.blur()} />
            </AutoComplete>
            <Button type="link" size="small" disabled={disabled || editor.settings!.overrides[name] == null}
              onClick={() => void editor.save(name, "")}>{uiText("client.chat.restoreDefaults")}</Button>
          </div>;
        })}
      </div>
      <div className={styles.add}>
        <Input aria-label={uiText("client.guiSettings.modelNameToAdd")} placeholder={uiText("client.guiSettings.enterAModelName")}
          value={model} disabled={disabled} onChange={(event) => setModel(event.target.value)} />
        <AutoComplete value={capacity} options={options} onChange={setCapacity} disabled={disabled}
          className={styles.capacity}>
          <Input aria-label={uiText("client.guiSettings.newModelContextCapacity")} placeholder={uiText("client.guiSettings.capacity")} suffix="K" inputMode="decimal" />
        </AutoComplete>
        <Button disabled={disabled || !model.trim() || !capacity.trim()} onClick={() => void add()}>
          {uiText("client.shared.add")}</Button>
      </div>
      <p>{uiText("client.guiSettings.1K1000TokensAvailableCapacityExcludesReservedSpace")}</p>
    </>}
  </section>;
}
