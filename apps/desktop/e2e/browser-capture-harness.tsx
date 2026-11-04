import { createRoot } from 'react-dom/client';
import { RichText } from '../../../shared/conversation/RichText';
import { ImageThreadContext } from '../../../shared/conversation/useImageSource';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { ChatMarkdown } from '../../../shared/remote-chat/views/ChatMarkdown';
import { ChatImage, ChatImageContext } from '../../../shared/remote-chat/views/ChatImage';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';

const params = new URLSearchParams(location.search);
const entry = params.get('entry') ?? 'local';
const appearance = params.has('dark') ? 'dark' : 'light';
setInterfaceLanguage('zh');
if (entry === 'web') {
  await import('../../web/src/styles.css');
  await import('../../../shared/remote-chat/views/messages.css');
  setThemeMode(appearance);
} else {
  await import('../src/styles.css');
  if (entry === 'remote') await import('../src/pages/codexGui/remote/remoteGui.less');
  applyThemeMode(appearance);
}
const fixture: { markdown: string } = await fetch('/capture-fixture.json').then(response => response.json());
const load = async (threadId: string, source: string, original = false) => {
  const response = await fetch('/capture-image', { method: 'POST', body: JSON.stringify({
    threadId, source, variant: original ? 'original' : 'thumbnail',
  }) });
  return (await response.json()).url as string;
};
const remote: FileEnvironment = {
  remote: true, resolveWebsite: async url => url,
  previews: { open: async () => null, close: async () => {} },
  actions: { applications: async () => [], perform: async () => { throw new Error('Unexpected file action'); } },
  image: ({ src, alt }) => <ChatImage source={src} description={alt} />,
};
const text = fixture.markdown.replace('![]', '![浏览器截图]');
createRoot(document.getElementById('root')!).render(
  <ImageThreadContext.Provider value="capture-verification">
    <ChatImageContext.Provider value={{ threadId: 'capture-verification', ready: true, load }}>
      <FileEnvironmentContext.Provider value={entry === 'remote' ? remote : null}>
        <main style={{ maxWidth: 900, margin: '32px auto', padding: 24 }}>
          <article data-testid="reply" className={entry === 'remote' ? 'gui-remote-workspace chat-page' : 'chat-page'}>
            {entry === 'local' ? <RichText text={text} /> : <ChatMarkdown text={text} desktop />}
          </article>
        </main>
      </FileEnvironmentContext.Provider>
    </ChatImageContext.Provider>
  </ImageThreadContext.Provider>,
);
