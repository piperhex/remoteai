// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, foldAll, foldedRanges, language, syntaxTree } from '@codemirror/language';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectEditor } from '../../../../shared/project-browser/ProjectEditor';
import { editorLanguage } from '../../../../shared/project-browser/editorSetup';
import { displayText } from '../../../../shared/localization/messages';

const text = 'services:\n  mysql:\n    image: mysql:8.0\n    restart: unless-stopped\n';
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getClientRects: () => [], getBoundingClientRect: () => new DOMRect(),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(path = '/project/docker-compose.yml', prefix = '') {
  await act(async () => root.render(<ProjectEditor path={path} text={text} readOnly={false}
    t={key => prefix + displayText(key)} onChange={() => {}} save={() => {}} />));
  return EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
}

it('keeps the YAML parser, syntax tree and folds throughout repeated host/translation updates', async () => {
  const syntax = editorLanguage('/project/docker-compose.yml')!;
  const support = await syntax.load();
  const load = vi.spyOn(syntax, 'load');
  const editor = await render();
  ensureSyntaxTree(editor.state, text.length, 1000);
  expect(editor.state.facet(language)).toBe(support.language);
  act(() => { foldAll(editor); });
  const tree = syntaxTree(editor.state);
  const updates: boolean[] = [];
  act(() => editor.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
    updates.push(update.state.facet(language) === support.language && syntaxTree(update.state) === tree);
  })) }));
  for (let update = 0; update < 5; update += 1) {
    await render('/project/docker-compose.yml', update ? 'translated: ' : '');
  }
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.every(Boolean)).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
  expect(foldedRanges(editor.state).size).toBeGreaterThan(0);
  expect(container.querySelector('[aria-label="translated: 全部折叠"]')).not.toBeNull();
});

it('keeps the current grammar until the replacement loads and ignores a stale language load', async () => {
  const yaml = await editorLanguage('/project/docker-compose.yml')!.load();
  const javascript = await editorLanguage('/project/main.ts')!.load();
  let finish!: (value: typeof javascript) => void;
  vi.spyOn(editorLanguage('/project/main.ts')!, 'load')
    .mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const editor = await render();
  await render('/project/main.ts');
  expect(editor.state.facet(language)).toBe(yaml.language);
  await render('/project/notes.txt');
  expect(editor.state.facet(language)).toBeNull();
  await act(async () => { finish(javascript); });
  expect(editor.state.facet(language)).toBeNull();
});
