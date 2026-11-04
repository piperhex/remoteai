import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../shared/localization/useGuiLanguage";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Popover } from "antd";
import { Paperclip, Plus, Target } from "lucide-react";
import { ComposerPluginIcon } from "./ComposerPluginIcon";
import { useComposerPlugins } from "./useComposerPlugins";
import { useComposerSkills } from "./useComposerSkills";
import { ComposerSkillSection } from "./ComposerSkillSection";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import type { Skill } from "../../../../../shared/conversation/types";
import styles from "./ComposerAddMenu.module.less";

export function ComposerAddMenu({ cwd, disabled, active, anchor, onFiles, onGoal, onPlugin, onSkill }: {
  cwd: string; disabled: boolean; active: boolean; onFiles: () => void; onGoal: () => void;
  anchor: RefObject<HTMLDivElement>;
  onPlugin: (plugin: AttachmentReference) => void;
  onSkill: (skill: Skill) => void;
}) {
  useGuiLanguage();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(8);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const catalog = useComposerPlugins({ cwd, active: open && active && !disabled });
  const skills = useComposerSkills({ cwd, active: open && active && !disabled, connected: !disabled });
  useEffect(() => { setOpen(false); }, [cwd, disabled, active]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const content = <div ref={panel} className={styles.panel} role="menu" aria-label={uiText("client.shared.add")}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      event.preventDefault(); items[next]?.focus();
    }}>
    <div className={styles.heading}>{uiText("client.shared.add")}</div>
    <button type="button" role="menuitem" className={styles.option} onClick={() => { close(); onFiles(); }}>
      <Paperclip size={19} /><span>{uiText("client.composer.filesAndFolders")}</span>
    </button>
    <button type="button" role="menuitem" className={styles.option} onClick={() => { close(); onGoal(); }}>
      <Target size={19} /><span>{uiText("client.chat.goal")} <small>{uiText("client.composer.setAGoalToKeepWorkingToward")}</small></span>
    </button>
    <ComposerSkillSection catalog={skills}
      onChoose={(skill) => { close(); onSkill(skill); }} />
    <div className={styles.heading}>{uiText("client.chat.plugins")}</div>
    {catalog.plugins.map((plugin) => <button type="button" role="menuitem" key={plugin.id}
      className={styles.option} onClick={() => {
        onPlugin({ kind: "plugin", name: plugin.interface?.displayName || plugin.name, path: `plugin://${plugin.id}` });
        close();
      }}>
      <ComposerPluginIcon plugin={plugin} />
      <span>{plugin.interface?.displayName || plugin.name}
        <small>{plugin.interface?.shortDescription}</small></span>
    </button>)}
    {catalog.loading && <p role="status" className={styles.empty}>{uiText("client.chat.loadingPlugins")}</p>}
    {catalog.error && <p role="status" className={styles.empty}>{catalog.error}</p>}
    {!catalog.loading && !catalog.error && !catalog.plugins.length
      && <p className={styles.empty}>{uiText("client.composer.noPluginsAvailableInstallAndEnableThemInThePlugin")}</p>}
  </div>;
  return <Popover trigger="click" placement="topLeft" arrow={false} content={content}
    align={{ offset: [0, -offset] }} open={open && !disabled && active} onOpenChange={(visible) => {
      if (visible && trigger.current && anchor.current) {
        setOffset(trigger.current.getBoundingClientRect().top - anchor.current.getBoundingClientRect().top + 8);
      }
      setOpen(visible);
    }}
    afterOpenChange={(visible) => { if (visible) panel.current?.querySelector<HTMLButtonElement>("button")?.focus(); }}
    styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 20, overflow: "hidden" } }}>
    <button ref={trigger} type="button" className={styles.trigger} disabled={disabled}
      aria-label={uiText("client.shared.add")} aria-haspopup="menu" aria-expanded={open && !disabled && active}>
      <Plus size={21} strokeWidth={1.6} aria-hidden="true" />
    </button>
  </Popover>;
}
