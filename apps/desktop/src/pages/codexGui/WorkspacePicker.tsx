import { guiText } from "../../i18n/guiText";
import { useRef, useState } from "react";
import { Input, Modal, Popover, type InputRef } from "antd";
import { Check, GitBranch, GitFork, Laptop, Plus, Search } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import { useGitWorkspace } from "./useGitWorkspace";
import type { GitWorkspaceClient } from "./gitApi";
import styles from "./WorkspacePicker.module.less";

const MAX_BRANCH_LENGTH = 200;
const MENU_ALIGN = { overflow: { adjustX: true, adjustY: true, shiftX: true } };

export function WorkspacePicker({ cwd, disabled, onChange, onBusyChange, request, enabled = true, remote = false,
  localLabel = isDesktopApp ? guiText("本地") : guiText("Remote AI 主机") }: {
  cwd: string; disabled: boolean; onChange: (cwd: string) => void; onBusyChange: (busy: boolean) => void;
  localLabel?: string; request?: GitWorkspaceClient; enabled?: boolean; remote?: boolean;
}) {
  const git = useGitWorkspace({ cwd, onChange, onBusyChange, request, enabled });
  const [menu, setMenu] = useState<"branch" | "location" | null>(null);
  const [dialog, setDialog] = useState<"branch" | "worktree" | null>(null);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const search = useRef<InputRef>(null);
  const locked = disabled || git.busy || git.loading;
  const worktreeLabel = remote ? guiText("远程工作树") : guiText("本地工作树");
  const createWorktreeLabel = remote ? guiText("新建远程工作树") : guiText("新建本地工作树");
  const locationLabel = git.status?.isWorktree ? worktreeLabel : localLabel;
  const computerLabel = remote ? guiText("远程电脑") : guiText("本地");
  const branchLabel = git.status?.branch ?? (git.status ? guiText("分离的 HEAD") : guiText("Git 分支"));
  const branches = git.status?.branches.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const openDialog = (kind: "branch" | "worktree") => { setMenu(null); setBranch(""); setDialog(kind); };
  const create = async () => {
    if (locked || !branch.trim()) return;
    const operation = dialog === "worktree" ? "createWorktree" : "switch";
    if (await git.run({ operation, cwd, branch: branch.trim(), create: true })) setDialog(null);
  };
  const toggle = (kind: "branch" | "location", open: boolean) => {
    setMenu(open ? kind : null);
    if (open) { setQuery(""); void git.refresh(); }
  };
  const notice = git.error && <p role="alert" className={styles.notice}>{git.error}</p>;
  const branchPanel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setMenu(null); }
  }}>
    <Input ref={search} prefix={<Search size={16} />} variant="borderless" aria-label={guiText("搜索分支")} placeholder={guiText("搜索分支")}
      value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className={styles.caption}>{git.loading ? guiText("正在读取分支…") : guiText("分支")}</div>
    <div className={styles.list} role="menu" aria-label={guiText("Git 分支")}>
      {branches.map((item) => <button type="button" role="menuitemradio" key={item.name}
        aria-checked={item.name === git.status?.branch} disabled={locked || item.occupied}
        className={styles.option} onClick={async () => {
          if (locked) return;
          if (await git.run({ operation: "switch", cwd, branch: item.name, create: false })) setMenu(null);
        }}>
        <GitBranch size={17} /><span>{item.name}
          {item.name === git.status?.branch && <small>{guiText("未提交：")}{git.status.changedFiles}  {guiText("个文件")}</small>}
          {item.occupied && <small>{guiText("已在其他工作树中打开")}</small>}
        </span>{item.name === git.status?.branch && <Check size={17} />}
      </button>)}
      {!branches.length && <p className={styles.caption}>{query ? guiText("没有找到匹配的分支") : guiText("还没有分支")}</p>}
    </div>
    {notice}
    <button type="button" className={`${styles.option} ${styles.create}`} disabled={locked || !git.status}
      onClick={() => openDialog("branch")}><Plus size={18} />{guiText("创建并切换新分支…")}</button>
  </div>;
  const locationPanel = <div className={styles.panel} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setMenu(null); }
  }}>
    <div className={styles.caption}>{guiText("工作位置")}</div>
    <div className={styles.option}><Laptop size={18} />
      <span>{git.status?.isWorktree ? worktreeLabel : computerLabel}</span>
      <Check size={17} /></div>
    <button type="button" className={styles.option} disabled={locked || !git.status}
      onClick={() => openDialog("worktree")}><GitFork size={18} /><span>{createWorktreeLabel}</span></button>
    <p className={styles.caption}>{guiText("从当前提交创建独立副本，方便并行工作。")}</p>{notice}
  </div>;
  return <>
    <Popover trigger="click" placement="topLeft" align={MENU_ALIGN} arrow={false}
      open={menu === "location" && !disabled}
      onOpenChange={(open) => toggle("location", open)} content={locationPanel}
      styles={{ root: { maxWidth: 400 }, body: { padding: 6, borderRadius: 18 } }}>
      <button type="button" className={styles.trigger} disabled={disabled || git.busy}
        aria-label={guiText("工作位置")} aria-haspopup="menu" aria-expanded={menu === "location"}>
        <Laptop size={16} /><span>{locationLabel}</span>
      </button>
    </Popover>
    {cwd && <Popover trigger="click" placement="topLeft" align={MENU_ALIGN} arrow={false}
      open={menu === "branch" && !disabled}
      onOpenChange={(open) => toggle("branch", open)} content={branchPanel}
      afterOpenChange={(open) => { if (open) search.current?.focus(); }}
      styles={{ root: { maxWidth: 400 }, body: { padding: 6, borderRadius: 18 } }}>
      <button type="button" className={styles.trigger} disabled={disabled || git.busy}
        aria-label={guiText("切换 Git 分支")} aria-haspopup="menu" aria-expanded={menu === "branch"}>
        <GitBranch size={16} /><span>{branchLabel}</span>
      </button>
    </Popover>}
    {dialog && <Modal open centered width={400} title={dialog === "worktree" ? createWorktreeLabel : guiText("创建新分支")}
      okText={dialog === "worktree" ? guiText("创建工作树") : guiText("创建并切换")} cancelText={guiText("取消")}
      confirmLoading={git.busy} okButtonProps={{ disabled: locked || !branch.trim() }}
      cancelButtonProps={{ disabled: git.busy }} closable={!git.busy} maskClosable={!git.busy} keyboard={!git.busy}
      onCancel={() => setDialog(null)} onOk={() => void create()}>
      <p>{dialog === "worktree" ? guiText("新对话将使用独立的工作树。未提交的修改会保留在原目录。")
        : guiText("从当前提交创建分支，并在新对话中使用。")}</p>
      <Input autoFocus aria-label={guiText("新分支名称")} placeholder={guiText("新分支名称，如 feature/login")} value={branch}
        maxLength={MAX_BRANCH_LENGTH} disabled={git.busy} onChange={(event) => setBranch(event.target.value)}
        onPressEnter={() => void create()} />{notice}
    </Modal>}
  </>;
}
