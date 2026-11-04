import { Check, ChevronRight, CircleUserRound, PanelsTopLeft, Power, RotateCw, Settings2, Waves } from "lucide-react";
import type { MenuEntry } from "./types";
import { remainingTone } from "../../../../../shared/accounts/format";

const ACTION_ICONS = {
  "tray:settings": Settings2,
  "tray:dashboard": PanelsTopLeft,
  "tray:restart-chatgpt": RotateCw,
  "tray:restart-app": RotateCw,
  "tray:quit": Power,
  "tray:toggle-floating-bubble": Waves,
};

function Quota({ text }: { text: string }) {
  const [label, value] = text.split(" ");
  const percent = Number.parseFloat(value);
  const tone = Number.isFinite(percent) ? remainingTone(percent) : "muted";
  return <span className={`quick-menu-quota ${tone}`}><small>{label}</small><b>{value}</b></span>;
}

function RowIcon({ entry, checked }: { entry: MenuEntry; checked: boolean }) {
  if (checked) return <Check size={15} />;
  const Icon = ACTION_ICONS[entry.id as keyof typeof ACTION_ICONS];
  if (Icon) return <Icon size={16} />;
  if (entry.id.startsWith("tray:account:")) return <CircleUserRound size={16} />;
  return <span className="quick-menu-dot" />;
}

export function MenuRow({ entry, onActivate }: { entry: MenuEntry; onActivate: (entry: MenuEntry) => void }) {
  if (entry.separator) return <div className="quick-menu-divider" role="separator" />;
  if (entry.id.endsWith("-header")) return <div className="quick-menu-section">{entry.text}</div>;
  const account = entry.id.startsWith("tray:account:");
  const checked = entry.checked || entry.text.startsWith("✓ ");
  const text = entry.text.replace(/^✓ /, "");
  const parts = account ? text.split(" · ") : [text];
  const hasChildren = entry.children.length > 0;
  const checkable = account || entry.id.startsWith("tray:provider") || entry.id.startsWith("tray:provider-model");
  return (
    <button
      type="button"
      data-menu-id={entry.id}
      role={checkable && !hasChildren ? "menuitemradio" : "menuitem"}
      aria-checked={checkable && !hasChildren ? checked : undefined}
      aria-haspopup={hasChildren ? "menu" : undefined}
      disabled={!entry.enabled}
      className={`quick-menu-row ${checked ? "is-current" : ""} ${entry.id === "tray:quit" ? "is-quit" : ""}`}
      onClick={() => onActivate(entry)}
    >
      <span className="quick-menu-icon" aria-hidden="true">
        <RowIcon entry={entry} checked={checked} />
      </span>
      <span className="quick-menu-label">{parts[0]}</span>
      {account && <span className="quick-menu-quotas">
        {parts.slice(1).map((part) => <Quota key={part} text={part} />)}
      </span>}
      {hasChildren && <ChevronRight size={14} className="quick-menu-chevron" aria-hidden="true" />}
    </button>
  );
}
