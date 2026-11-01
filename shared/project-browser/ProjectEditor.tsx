import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab, undo, redo } from '@codemirror/commands';
import { foldAll, unfoldAll } from '@codemirror/language';
import { closeSearchPanel, openSearchPanel, search, searchPanelOpen } from '@codemirror/search';
import { ChevronsDownUp, ChevronsUpDown, GitCommitHorizontal, Redo2, Search, Undo2, WrapText } from 'lucide-react';
import { editorHighlighting, editorLanguage, editorPhrases, editorTheme, textFolding } from './editorSetup';
import { editorExtensions } from './editorExtensions';
import type { BrowserTranslate } from './ProjectTree';
import type { BrowserHost } from './entryActions';
import { useEditorSelectionMenu } from './useEditorSelectionMenu';
import { EditorSelectionMenu } from './EditorSelectionMenu';
import { EditorSearchPanel } from './editorSearchPanel';
import { utf8ToBytes } from '@noble/hashes/utils';
import { PROJECT_FILE_CHUNK_BYTES, PROJECT_PLAIN_TEXT_THRESHOLD } from './protocol';
import { useNpmScriptButtons } from './useNpmScriptButtons';
import { useGitBlame, type BlameSource } from './useGitBlame';
import { GutterMenu } from './GutterMenu';
import { BrowserFullscreenButton } from './browserFullscreen';

interface Props {
  text: string; path: string; readOnly: boolean; t: BrowserTranslate;
  onChange: (text: string) => void; save: () => void;
  quoteSelection?: BrowserHost['quoteSelection'];
  prepareScript?: () => Promise<boolean>;
  blame?: BlameSource;
  windowed?: boolean;
  bounded?: boolean;
}

export function ProjectEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const settings = useRef({ editable: new Compartment(), wrapping: new Compartment(),
    language: new Compartment(), features: new Compartment() });
  const latest = useRef(props);
  const synchronizing = useRef(false);
  latest.current = props;
  const [wrap, setWrap] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [plainText, setPlainText] = useState(() => !!props.windowed || utf8ToBytes(props.text).length > PROJECT_PLAIN_TEXT_THRESHOLD);
  const byteLength = useRef(0);
  const selectionMenu = useEditorSelectionMenu({ view, path: props.path, enabled: !!props.quoteSelection });
  const blame = useGitBlame(view, props.blame, props.t);
  useNpmScriptButtons(view, { path: props.path, disabled: props.readOnly, plainText, t: props.t,
    prepare: props.prepareScript });
  useLayoutEffect(() => {
    if (!host.current) return;
    const { editable, wrapping, language, features } = settings.current;
    byteLength.current = utf8ToBytes(props.text).length;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: props.text, extensions: [
        EditorState.transactionFilter.of(transaction => {
          if (!latest.current.bounded || !transaction.docChanged) return transaction;
          if (transaction.newDoc.length <= PROJECT_FILE_CHUNK_BYTES
            && utf8ToBytes(transaction.newDoc.sliceString(0, transaction.newDoc.length,
            transaction.startState.lineBreak)).length <= PROJECT_FILE_CHUNK_BYTES) {
            setLimitReached(false); return transaction;
          }
          setLimitReached(true); return [];
        }),
        features.of(editorExtensions(props.t, plainText)), editorTheme, editorPhrases(props.t),
        search({ top: true, createPanel: editor => new EditorSearchPanel(editor, latest.current.t) }),
        EditorState.lineSeparator.of(props.text.includes('\r\n') ? '\r\n' : '\n'),
        EditorView.contentAttributes.of({ 'aria-label': props.t("client.workspaceActions.fileContent"), spellcheck: 'false',
          autocorrect: 'off', autocapitalize: 'off' }),
        editable.of(EditorState.readOnly.of(props.readOnly)), wrapping.of([]), language.of([]),
        keymap.of([indentWithTab, { key: 'Mod-s', run: () => { latest.current.save(); return true; } }]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            update.changes.iterChanges((fromA, toA, fromB, toB) => {
              byteLength.current += utf8ToBytes(update.state.sliceDoc(fromB, toB)).length
                - utf8ToBytes(update.startState.sliceDoc(fromA, toA)).length;
            });
            setPlainText(!!latest.current.windowed || byteLength.current > PROJECT_PLAIN_TEXT_THRESHOLD);
          }
          if (searchPanelOpen(update.startState) !== searchPanelOpen(update.state)) {
            setSearchOpen(searchPanelOpen(update.state));
          }
          if (update.docChanged || update.selectionSet) selectionMenu.changed(update.docChanged);
          if (update.docChanged && !synchronizing.current) latest.current.onChange(update.state.sliceDoc());
        }),
      ] }),
    });
    view.current = editor;
    return () => {
      editor.destroy(); view.current = undefined;
    };
    // A document version remounts this editor; keystrokes must not recreate it or reset history.
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const { features, language } = settings.current;
    const syntax = plainText ? null : editorLanguage(props.path);
    setLanguageError(false);
    editor.dispatch({ effects: [features.reconfigure(editorExtensions(props.t, plainText)),
      language.reconfigure(plainText ? [] : [editorHighlighting, ...(syntax ? [] : [textFolding])])] });
    let cancelled = false;
    if (syntax) void syntax.load().then(support => {
      if (!cancelled) editor.dispatch({ effects: language.reconfigure([editorHighlighting, support]) });
    }).catch(() => { if (!cancelled) setLanguageError(true); });
    return () => { cancelled = true; };
  }, [plainText, props.path, props.t]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === props.text) return;
    // Another view of the same project may have edited this draft while this editor was hidden.
    synchronizing.current = true;
    try {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.text },
        annotations: Transaction.addToHistory.of(false) });
    } finally { synchronizing.current = false; }
  }, [props.text]);
  useEffect(() => {
    view.current?.dispatch({ effects: settings.current.editable.reconfigure(EditorState.readOnly.of(props.readOnly)) });
  }, [props.readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: settings.current.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  const command = (run: (editor: EditorView) => boolean) => { if (view.current) run(view.current); };
  return <div className="pf-editor" data-plain-text={plainText}>
    <div className="pf-editor-tools" role="toolbar" aria-label={props.t("client.projectBrowser.editorTools")}>
      <button type="button" aria-expanded={searchOpen} aria-pressed={searchOpen}
        onClick={() => command(editor => searchPanelOpen(editor.state)
          ? closeSearchPanel(editor) : openSearchPanel(editor))}>
        <Search size={16} /><span>{props.t("client.projectBrowser.find")}</span></button>
      <button type="button" aria-label={props.t("client.projectBrowser.undo")} disabled={props.readOnly} onClick={() => command(undo)}>
        <Undo2 size={16} /></button>
      <button type="button" aria-label={props.t("client.projectBrowser.redo")} disabled={props.readOnly} onClick={() => command(redo)}>
        <Redo2 size={16} /></button>
      {!plainText && <><button type="button" aria-label={props.t("client.projectBrowser.foldAll")} onClick={() => command(foldAll)}>
        <ChevronsDownUp size={16} /></button>
      <button type="button" aria-label={props.t("client.projectBrowser.unfoldAll")} onClick={() => command(unfoldAll)}>
        <ChevronsUpDown size={16} /></button></>}
      <button type="button" aria-label={props.t("client.projectBrowser.wrapLines")} aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
        <WrapText size={16} /></button>
      {languageError && <span role="status">{props.t("client.projectBrowser.syntaxHighlightingIsUnavailable")}</span>}
      {props.blame && <button type="button" aria-label={props.t('client.gitBlame.annotate')}
        aria-pressed={blame.enabled} onClick={blame.toggle}><GitCommitHorizontal size={16} /></button>}
      <BrowserFullscreenButton t={props.t} />
    </div>
    {limitReached && <p className="pf-notice" role="alert">{props.t('client.projectBrowser.windowEditLimit')}</p>}
    {plainText && !props.windowed && <p className="pf-notice" role="status">{props.t('client.projectBrowser.largePlainText')}</p>}
    {blame.notice && <p className="pf-notice pf-blame-notice" role="status">{blame.notice}</p>}
    <div ref={host} className="pf-editor-host" {...blame.handlers} />
    {blame.menu && <GutterMenu position={blame.menu} enabled={blame.enabled}
      toggle={() => { blame.toggle(); if (!blame.menu?.touch) view.current?.focus(); }}
      close={() => { blame.close(); if (!blame.menu?.touch) view.current?.focus(); }} t={props.t} />}
    {selectionMenu.menu && view.current && props.quoteSelection && <EditorSelectionMenu
      menu={selectionMenu.menu} editor={view.current} quoteSelection={props.quoteSelection}
      close={selectionMenu.close} t={props.t} />}
  </div>;
}
