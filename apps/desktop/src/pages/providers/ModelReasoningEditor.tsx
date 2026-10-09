import { AutoComplete, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import { useTokenCostDisplaySettings } from "../../hooks/useTokenCostDisplaySettings";
import { TOKEN_PRICE_DISPLAY_PRECISION } from "../../utils/tokenCost";
import type { ProviderApiFormat, ReasoningEffort } from "../../types";
import {
  CONTEXT_WINDOW_OPTIONS,
  DEFAULT_CONTEXT_WINDOW_K,
  defaultReasoningEfforts,
  type ModelReasoningConfig,
  reasoningEffortOptions,
  supportsImageInputByDefault,
} from "./providerUtils";

interface ModelReasoningEditorProps {
  value: ModelReasoningConfig[];
  disabled: boolean;
  onChange: (value: ModelReasoningConfig[]) => void;
  t: Translate;
}

function usesDefaults(config: ModelReasoningConfig) {
  const defaults = defaultReasoningEfforts(config.model);
  return config.reasoningEfforts.length === defaults.length
    && config.reasoningEfforts.every((effort, index) => effort === defaults[index]);
}

function usesDefaultImageSupport(config: ModelReasoningConfig) {
  return config.supportsImageInput === supportsImageInputByDefault(config.model);
}

export function ModelReasoningEditor({
  value,
  disabled,
  onChange,
  t,
}: ModelReasoningEditorProps) {
  const display = useTokenCostDisplaySettings();
  const updateModel = (index: number, model: string) => {
    onChange(value.map((config, rowIndex) => {
      if (rowIndex !== index) return config;
      const reasoningEfforts = !config.model.trim() || usesDefaults(config)
        ? defaultReasoningEfforts(model)
        : config.reasoningEfforts;
      const supportsImageInput = !config.model.trim() || usesDefaultImageSupport(config)
        ? supportsImageInputByDefault(model)
        : config.supportsImageInput;
      return { ...config, model, reasoningEfforts, supportsImageInput };
    }));
  };
  const updateEfforts = (index: number, reasoningEfforts: ReasoningEffort[]) => {
    onChange(value.map((config, rowIndex) => (
      rowIndex === index ? { ...config, reasoningEfforts } : config
    )));
  };
  const updateContextWindow = (index: number, contextWindowK: string) => {
    onChange(value.map((config, rowIndex) => (
      rowIndex === index ? { ...config, contextWindowK } : config
    )));
  };
  const updateApiFormat = (index: number, apiFormat: ProviderApiFormat | "auto") => {
    onChange(value.map((config, rowIndex) => (
      rowIndex === index ? { ...config, apiFormat } : config
    )));
  };
  const updateImageInput = (index: number, supportsImageInput: boolean) => {
    onChange(value.map((config, rowIndex) => (
      rowIndex === index ? { ...config, supportsImageInput } : config
    )));
  };
  const updateUnitCost = (index: number, unitCost: number | null) => onChange(value.map((config, rowIndex) => (
    rowIndex === index ? { ...config, unitCost } : config
  )));
  const remove = (index: number) => onChange(value.filter((_, rowIndex) => rowIndex !== index));
  const add = () => onChange([...value, {
    model: "",
    reasoningEfforts: [],
    contextWindowK: DEFAULT_CONTEXT_WINDOW_K,
    apiFormat: "auto",
    supportsImageInput: false,
    unitCost: null,
  }]);
  const apiFormatOptions = [
    { label: t("providers.form.apiProtocolAuto"), value: "auto" },
    { label: "Responses", value: "openaiResponses" },
    { label: "Chat Completions", value: "openaiChat" },
  ];

  return <div className="provider-model-editor">
    <div className="provider-model-editor-head">
      <span>{t("providers.form.modelName")}</span>
      <span>{t("providers.form.reasoningEfforts")}</span>
      <span>{t("providers.form.contextWindow")}</span>
      <span>{t("providers.form.apiProtocol")}</span>
      <span>{t("providers.form.imageInputModels")}</span>
      <span>{t("providers.form.unitCostPerMillion", { unit: display.unit })}</span>
      <span />
    </div>
    {value.map((config, index) => <div className="provider-model-editor-row" key={index}>
      <Input value={config.model} disabled={disabled}
        placeholder="gpt-5.6-sol" onChange={(event) => updateModel(index, event.target.value)} />
      <Select mode="multiple" value={config.reasoningEfforts} disabled={disabled}
        maxTagCount="responsive" options={reasoningEffortOptions(t)}
        optionRender={(option) => <>{option.label}（{option.value}）</>}
        placeholder={t("providers.form.reasoningEffortsPlaceholder")}
        onChange={(efforts) => updateEfforts(index, efforts as ReasoningEffort[])} />
      <AutoComplete value={config.contextWindowK} disabled={disabled}
        options={CONTEXT_WINDOW_OPTIONS} placeholder={DEFAULT_CONTEXT_WINDOW_K} allowClear
        onChange={(contextWindowK) => updateContextWindow(index, contextWindowK)} />
      <Select value={config.apiFormat} disabled={disabled} options={apiFormatOptions}
        onChange={(apiFormat) => updateApiFormat(index, apiFormat)} />
      <Checkbox checked={config.supportsImageInput} disabled={disabled}
        aria-label={`${t("providers.form.imageInputModels")}: ${config.model}`}
        onChange={(event) => updateImageInput(index, event.target.checked)} />
      <InputNumber min={0} precision={TOKEN_PRICE_DISPLAY_PRECISION}
        value={config.unitCost == null ? null : config.unitCost * display.usdMultiplier} disabled={disabled}
        placeholder="Sol" onChange={(next) => updateUnitCost(index, next == null ? null : next / display.usdMultiplier)} />
      <Button type="text" danger icon={<Trash2 size={14} />} disabled={disabled || value.length === 1}
        aria-label={t("providers.form.removeModel")} onClick={() => remove(index)} />
    </div>)}
    <Button className="provider-model-add" icon={<Plus size={14} />} disabled={disabled} onClick={add}>
      {t("providers.form.addModel")}
    </Button>
  </div>;
}
