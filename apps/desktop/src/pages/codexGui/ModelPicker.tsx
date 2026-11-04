import { displayText } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Popover, Tooltip } from "antd";
import { Check, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, Zap } from "lucide-react";
import type { Model } from "../../../../../shared/conversation/types";
import { modelSelectionError, resolveModelSelection, type ModelSelection } from "../../../../../shared/conversation/modelSelection";
import styles from "./ModelPicker.module.less";
import { GuiSpeedButton } from './GuiSpeedButton';
import { EFFORT_LABELS, type RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { requestSpeedSuffix, speedBoltCount } from '../../../../../shared/remote-chat/requestSpeed';
const EFFORT_ORDER = Object.keys(EFFORT_LABELS);
const MODEL_SEARCH_THRESHOLD = 8;
interface ModelPickerProps extends ModelSelection {
  models: Model[];
  disabled: boolean;
  speed?: RequestSpeed;
  onChange: (selection: ModelSelection) => void;
  onRetry?: () => void | Promise<void>;
  error?: string;
}

function moveModelFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  event.preventDefault();
  buttons[next]?.focus();
}

function ModelList({ models, model, onSelect, onBack, onRefresh, refreshing }: {
  models: Model[]; model: string; onSelect: (model: string) => void; onBack: () => void;
  onRefresh?: () => Promise<void>; refreshing: boolean;
}) {
  const [query, setQuery] = useState("");
  const options = models.map((entry) => ({ value: entry.model, label: entry.displayName || entry.model }))
    .filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className={styles.models}>
    <div className={styles.listHeader}>
      <button className={styles.listHeading} onClick={onBack} aria-label={uiText("client.chat.backToReasoningEffort")}>
        <ChevronLeft size={12} /><span>{uiText("client.shared.chooseModel")}</span>
      </button>
      <Tooltip title={uiText("client.chat.refresh")} styles={{ root: { maxWidth: 400 } }}>
        <Button type="text" size="small" className={styles.refresh} icon={<RefreshCw size={14} />}
          aria-label={uiText("client.chat.refresh")} aria-busy={refreshing} loading={refreshing}
          disabled={!onRefresh || refreshing} onClick={onRefresh} />
      </Tooltip>
    </div>
    {models.length > MODEL_SEARCH_THRESHOLD && <Input size="small" className={styles.search}
      prefix={<Search size={12} />}
      placeholder={uiText("client.chat.searchModels")} aria-label={uiText("client.chat.searchModels")} value={query} allowClear
      onChange={(event) => setQuery(event.target.value)} />}
    <div className={styles.modelList} role="menu" aria-label={uiText("client.shared.chooseModel")} onKeyDown={moveModelFocus}>
      {options.map((option) => <button key={option.value} type="button" role="menuitemradio"
        className={styles.modelOption} aria-checked={model === option.value}
        autoFocus={models.length <= MODEL_SEARCH_THRESHOLD && model === option.value}
        onClick={() => onSelect(option.value)}>
        <span>{option.label}</span>
        {model === option.value && <Check size={14} />}
      </button>)}
      {!options.length && <p className={styles.hint}>{uiText("client.chat.noModelsFound")}</p>}
    </div>
  </div>;
}

export function ModelPicker(props: ModelPickerProps) {
  const { models, onChange } = props;
  const { model, effort } = resolveModelSelection(models, props);
  const unavailable = modelSelectionError(models, { model, effort });
  const disabled = props.disabled || !model;
  const [open, setOpen] = useState(false);
  const [choosingModel, setChoosingModel] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshPending = useRef(false);
  const refresh = async () => {
    if (!props.onRetry || refreshPending.current) return;
    refreshPending.current = true; setRefreshing(true);
    try { await props.onRetry(); }
    finally { refreshPending.current = false; setRefreshing(false); }
  };
  const selected = models.find((entry) => entry.model === model);
  const modelLabel = selected?.displayName || model || uiText("client.chat.loadingModels");
  const effortLabel = displayText(EFFORT_LABELS[effort] || effort);
  const speedBolts = speedBoltCount(props.speed ?? 'normal');
  const recommended = resolveModelSelection(models, { model, effort: "" });
  const levels = [...(selected?.supportedReasoningEfforts ?? [])].sort((left, right) =>
    EFFORT_ORDER.indexOf(left.reasoningEffort) - EFFORT_ORDER.indexOf(right.reasoningEffort));
  const index = Math.max(0, levels.findIndex((level) =>
    level.reasoningEffort === (effort || selected?.defaultReasoningEffort)));
  // A source refresh briefly blocks selections until the new catalog is ready.
  useEffect(() => { if (props.disabled && props.error) setOpen(false); }, [props.disabled, props.error]);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) setChoosingModel(false);
  };
  const selectModel = (value: string) => {
    onChange(resolveModelSelection(models, { model: value, effort: "" }));
    setChoosingModel(false);
  };
  const panel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  }}>
    {choosingModel ? <ModelList models={models} model={model} onSelect={selectModel}
      refreshing={refreshing} onRefresh={props.onRetry ? refresh : undefined}
      onBack={() => setChoosingModel(false)} /> : <div className={styles.reasoning}>
      <div className={styles.summary}>
        <span className={styles.speed}><GuiSpeedButton active={open && !disabled} /></span>
        <button className={styles.modelHeading} onClick={() => setChoosingModel(true)} aria-label={uiText("client.shared.chooseModel")}>
          <span className={styles.effortName}>{effortLabel}<ChevronRight size={12} /></span>
          <span className={styles.modelName}>{modelLabel}</span>
        </button>
        <Tooltip title={uiText("client.chat.resetToRecommendedReasoningEffort")} styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" size="small" className={styles.reset} icon={<RotateCcw size={14} />}
            disabled={!selected || effort === recommended.effort}
            aria-label={uiText("client.chat.resetToRecommendedReasoningEffort")}
            onClick={() => onChange(recommended)} />
        </Tooltip>
      </div>
      {levels.length > 0 ? <div className={styles.sliderWrap}>
        <input type="range" className={styles.slider} min={0} max={Math.max(1, levels.length - 1)} step={1}
          value={index} disabled={levels.length < 2} aria-label={uiText("client.shared.reasoningEffort")}
          aria-valuetext={displayText(EFFORT_LABELS[levels[index].reasoningEffort] || levels[index].reasoningEffort)}
          onChange={(event) => onChange({ model, effort: levels[Number(event.target.value)].reasoningEffort })} />
        <div className={styles.stops} aria-hidden="true">
          {levels.map((level) => <i key={level.reasoningEffort} />)}
        </div>
      </div> : <p className={styles.hint}>{uiText("client.chat.thisModelDoesNotSupportAdjustableReasoningEffort")}</p>}
    </div>}
  </div>;
  if (!model || (props.disabled && props.error)) {
    const loading = (props.disabled && !props.error) || refreshing;
    let label = uiText("client.chat.noModelsAvailableClickToRetry");
    if (loading) label = uiText("client.chat.loadingModels");
    else if (props.error) label = uiText("client.chat.couldNotLoadModelsClickToRetry");
    return <button type="button" className={`${styles.trigger} ${styles.catalogStatus}`}
      disabled={loading || !props.onRetry}
      aria-busy={loading} onClick={refresh}>
      <span className={styles.triggerModel}>{label}</span>
    </button>;
  }
  return <Popover trigger="click" placement="topRight" arrow={false} open={open && !disabled}
    onOpenChange={changeOpen} content={panel} styles={{ root: { maxWidth: 400 },
      body: { padding: 0, borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgb(0 0 0 / 8%)" } }}>
    <Tooltip title={unavailable ? uiText(unavailable) : undefined} styles={{ root: { maxWidth: 400 } }}>
    <button type="button" className={styles.trigger} disabled={disabled} aria-expanded={open && !disabled}
      data-model-unavailable={unavailable ? true : undefined}
      aria-label={uiText("client.conversation.modelAndReasoningEffort", { value1: modelLabel, value2: effortLabel })
        + requestSpeedSuffix(props.speed, displayText)}>
      <span className={styles.triggerModel}>{modelLabel}</span>
      {effortLabel && <span className={styles.triggerEffort}>{effortLabel}</span>}
      {speedBolts > 0 && <span className={styles.triggerSpeed} aria-hidden="true" data-speed={props.speed}>
        <span className={styles.speedSeparator}>·</span>
        {Array.from({ length: speedBolts }, (_, index) => <Zap key={index} size="1em" />)}
      </span>}
    </button>
    </Tooltip>
  </Popover>;
}
