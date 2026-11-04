import inlineCopy from '@remoteai/i18n/copy/inline/desktop/pages/codexConfig/useTomlEditor';
import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState } from "react";
import { validateCodexConfigDocument } from "../../api/codexConfig";
import type { Language } from "../../i18n";

export interface TomlEditorProps {
  open: boolean;
  content: string;
  revision: string;
  language?: Language;
  saveError?: string;
  onSave: (content: string, expectedRevision: string) => Promise<string | false>;
  onClose: () => void;
}

type ParseIssue = NonNullable<Awaited<ReturnType<typeof validateCodexConfigDocument>>>;
type EditorStatus = "clean" | "changed" | "checking" | "saving" | "saved" | "error";
const VALIDATION_DELAY_MS = 350;

export function useTomlEditor(props: TomlEditorProps) {
  const { open, content, revision, language = "zh" } = props;
  const [draft, setDraft] = useState(content);
  const [issue, setIssue] = useState<ParseIssue | null>(null);
  const [status, setStatus] = useState<EditorStatus>("clean");
  const [saving, setSaving] = useState(false);
  const latest = useRef(content);
  const saved = useRef(content);
  // Unsaved source edits stay tied to the document version they started from.
  const baseRevision = useRef(revision);
  const saveFailure = useRef(false);
  const wasOpen = useRef(false);
  const pending = useRef<{ value: string; promise: Promise<boolean> } | null>(null);
  const saveHandler = useRef(props.onSave);
  saveHandler.current = props.onSave;

  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open || (!opening && latest.current !== saved.current)) return;
    latest.current = content;
    saved.current = content;
    baseRevision.current = revision;
    saveFailure.current = false;
    setDraft(content);
    setIssue(null);
    setStatus("clean");
  }, [open, content, revision]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await validateCodexConfigDocument(draft);
        if (cancelled || latest.current !== draft || pending.current || saveFailure.current) return;
        setIssue(result);
        if (result) setStatus("error");
      } catch {
        // Saving performs its own validation and reports failures without exposing backend details.
      }
    }, VALIDATION_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [draft, open]);

  function edit(value: string) {
    latest.current = value;
    saveFailure.current = false;
    setDraft(value);
    setIssue(null);
    setStatus(value === saved.current ? "clean" : "changed");
  }

  function failure(message: string, fromSave = false) {
    saveFailure.current = fromSave;
    setIssue({ message, line: null, column: null });
    setStatus("error");
    return false;
  }

  async function saveValue(value: string): Promise<boolean> {
    saveFailure.current = false;
    setStatus("checking");
    const result = await validateCodexConfigDocument(value);
    if (value !== latest.current) return false;
    setIssue(result);
    if (result) { setStatus("error"); return false; }
    if (value === saved.current) { setStatus("clean"); return true; }
    setStatus("saving");
    const nextRevision = await saveHandler.current(value, baseRevision.current);
    if (nextRevision !== false) {
      saved.current = value;
      baseRevision.current = nextRevision;
    }
    if (value !== latest.current) { setStatus("changed"); return false; }
    if (nextRevision === false) return failure((language !== "zh" && language !== "en" ? uiText("client.configHelp.couldNotSaveYourEditsArePreservedPleaseTryAgain", {}, language) : language === "zh"
      ? inlineCopy["text_50598f87"]
      : inlineCopy["Could_not_save_Your_changes_dd2bcc79"]), true);
    setStatus("saved");
    return true;
  }

  async function save(): Promise<boolean> {
    const value = latest.current;
    if (pending.current) {
      const running = pending.current;
      const result = await running.promise;
      return running.value === value ? result : save();
    }
    setSaving(true);
    const promise = saveValue(value).catch(() => {
      if (value !== latest.current) return false;
      return failure((language !== "zh" && language !== "en" ? uiText("client.configHelp.couldNotValidateOrSaveYourEditsArePreservedPlease", {}, language) : language === "zh"
        ? inlineCopy["text_a1d77d35"]
        : inlineCopy["Could_not_validate_or_save_861f1064"]));
    });
    const running = { value, promise };
    pending.current = running;
    try { return await promise; }
    finally {
      if (pending.current === running) { pending.current = null; setSaving(false); }
    }
  }

  function discard() {
    if (pending.current) return false;
    latest.current = props.content;
    saved.current = props.content;
    baseRevision.current = props.revision;
    saveFailure.current = false;
    setDraft(props.content);
    setIssue(null);
    setStatus("clean");
    props.onClose();
    return true;
  }

  async function close() {
    const success = await save();
    if (success) props.onClose();
    return success;
  }

  const displayedIssue = saveFailure.current && props.saveError
    ? { message: props.saveError, line: null, column: null } : issue;
  return { draft, issue: displayedIssue, status, saving, edit, save, close, discard };
}
