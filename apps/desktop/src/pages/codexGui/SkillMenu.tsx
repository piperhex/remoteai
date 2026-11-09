import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef } from "react";
import { File, Folder, GitBranch, MessageSquare, Target, Terminal } from "lucide-react";
import { ComposerSkillIcon } from "./ComposerSkillIcon";
import type { ComposerOption } from "./composerOptions";
import styles from "./SkillInput.module.less";
import { useChatSurfaceTheme } from "../../../../../shared/remote-chat/views/useChatSurfaceTheme";

function menuLabels(kind: "coze" | "conversation" | "skill" | "command" | "file" | "ssh") {
  if (kind === 'ssh') return { heading: uiText('client.ssh.savedConnections'), label: uiText('client.ssh.savedConnections'),
    loading: uiText('client.mobile.loading'), empty: uiText('client.ssh.noMatchingConnections') };
  if (kind === "file") return { heading: uiText("client.fileReferences.referenceAFileOrFolder"), label: uiText("client.projectBrowser.projectFiles"),
    loading: uiText("client.fileReferences.searchingFiles"), empty: uiText("client.fileReferences.noMatchingFilesOrFolders") };
  if (kind === "coze") return { heading: uiText("client.desktopComposerExtras.chooseCozeContent"), label: "Coze",
    loading: uiText("client.desktopComposerExtras.loadingCozeContent"), empty: uiText("client.desktopComposerExtras.noMatchingPublishedContentPublishItInCozeFirst") };
  if (kind === "conversation") return { heading: uiText("client.conversation.referenceAConversationIncludeRecentContentWhenSending"), label: uiText("client.chat.conversations"),
    loading: uiText("client.chat.loadingConversations"), empty: uiText("client.workspaceActions.noOtherConversationsFoundTryEnteringAConversationName") };
  if (kind === "skill") return { heading: uiText("client.workspaceActions.chooseASkill"), label: uiText("client.chat.skills"),
    loading: uiText("client.chat.loadingSkills"), empty: uiText("client.workspaceActions.noMatchingSkills") };
  return { heading: uiText("client.workspaceActions.chooseACommandOrSkill"), label: uiText("client.chat.commandsAndSkills"),
    loading: uiText("client.chat.loadingSkills"), empty: uiText("client.chat.noMatchingCommandsOrSkills") };
}

function OptionIcon({ option }: { option: ComposerOption }) {
  if (option.kind === "file") return option.directory ? <Folder size={18} /> : <File size={18} />;
  if (option.kind === "skill") return <ComposerSkillIcon skill={option.skill} />;
  if (option.kind === "coze") return <GitBranch size={18} aria-hidden="true" />;
  if (option.kind === 'ssh') return <Terminal size={18} aria-hidden="true" />;
  if (option.kind === "conversation") return <MessageSquare size={18} aria-hidden="true" />;
  if (option.kind === "goal") return <Target size={18} aria-hidden="true" />;
  return <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity=".25" />
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength="100"
      strokeDasharray={`${option.command.percent ?? 0} 100`} transform="rotate(-90 8 8)" />
  </svg>;
}

export function SkillMenu({ id, options, selected, loading, error, onChoose, below,
  skillsOnly, conversations, coze, files, ssh, truncated }: {
  id: string; options: ComposerOption[]; selected: number; loading: boolean; error: string;
  onChoose: (option: ComposerOption) => void;
  below?: boolean; skillsOnly?: boolean; conversations?: boolean; coze?: boolean; files?: boolean;
  ssh?: boolean; truncated?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const surfaceTheme = useChatSurfaceTheme();
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  let kind: Parameters<typeof menuLabels>[0] = skillsOnly ? "skill" : "command";
  if (conversations) kind = "conversation";
  if (coze) kind = "coze";
  if (files) kind = "file";
  if (ssh) kind = 'ssh';
  const labels = menuLabels(kind);
  return <div className={`${styles.menu} ${below ? styles.menuBelow : ""}`} style={surfaceTheme}
    onMouseDown={(event) => event.preventDefault()}>
    <div className={styles.menuHeading}>{labels.heading}</div>
    <div ref={list} id={id} role="listbox" aria-label={labels.label}
      className={styles.options}>
      {options.map((option, index) => <button type="button" role="option" id={`${id}-${index}`}
        key={`${option.kind}-${option.key}`} tabIndex={-1}
        aria-selected={selected === index} aria-disabled={!option.enabled}
        onClick={() => option.enabled && onChoose(option)}>
        <OptionIcon option={option} />
        <span><strong>{option.label}{option.kind === "skill" && !option.enabled && uiText("client.chat.disabled")}</strong>
          <small>{option.description}</small></span>
      </button>)}
    </div>
    {loading && <p role="status">{labels.loading}</p>}
    {error && <p role="status">{error}</p>}
    {truncated && <p role="status">{uiText("client.fileReferences.showingPartialResultsEnterAMoreSpecificNameOrPath")}</p>}
    {!loading && !error && !options.length && <p role="status">{labels.empty}</p>}
  </div>;
}
