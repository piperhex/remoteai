import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize, useGuiFontSize, guiFontStyle } from '../../../shared/appearance/fontSize';
import { setGuiLanguage, uiText } from '../../../shared/localization/uiText';
import { isLanguage } from '../../../shared/localization/language';
import { guiApi } from '../../../shared/conversation/api';
import { RemoteSshComposerFixture, sshComposerStore } from '../../../shared/testing/sshComposerFixture';
import { SkillInput } from '../src/pages/codexGui/SkillInput';
import { ComposerReferences } from '../src/pages/codexGui/ComposerReferences';
import { GuiController } from '../src/pages/codexGui/controller';
import { useComposerDraft } from '../src/pages/codexGui/useComposerDraft';
import { applyThemeMode } from '../src/utils/themeMode';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';
import './ssh-mentions-harness.css';

const params = new URLSearchParams(location.search);
const remote = params.get('mode') === 'remote';
const dark = params.has('dark');
const language = params.get('lang');
setGuiLanguage(isLanguage(language) ? language : 'zh');
guiApi.request = async <T,>() => [{ id: 'f321c884-a198-4244-ad4f-53762b3d2aba',
  name: '查询库存', description: '库存工具', kind: 'workflow' }] as T;
applyThemeMode(dark ? 'dark' : 'light');
saveGlobalFontSize(params.has('large') ? 20 : 14);
localStorage.removeItem('codex-switch:gui-font-size');
const controller = new GuiController();
controller.send = async (text, images, skills, attachments) => {
  document.body.dataset.sent = JSON.stringify({ text, images, skills, attachments }); return true;
};
function LocalComposer() {
  const draft = useComposerDraft('ssh-fixture', controller);
  return <div className="ssh-local-composer">
    <ComposerReferences items={draft.draft.attachments ?? []} disabled={false} onRemove={draft.removeAttachment} />
    <SkillInput value={draft.draft} draftKey="ssh-fixture" cwd="F:/project" active connected disabled={false}
      sshProfiles={sshComposerStore} onSsh={reference => draft.addAttachments([reference])}
      onCoze={reference => draft.addAttachments([reference])}
      placeholder={uiText("client.fileReferences.describeATaskFilesConversationsSkillsCoze")} onChange={draft.editContent} onPaste={draft.paste} onSend={() => void draft.send()} />
  </div>;
}
function Harness() {
  const fontSize = useGuiFontSize();
  return <ApplicationTypography><ConfigProvider theme={{
    algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm],
    token: { colorPrimary: '#35ada7' },
  }}><main className={`ssh-composer-fixture ${remote ? 'gui-remote-workspace chat-page' : ''}`}
    style={guiFontStyle(fontSize)}>
    <header>Codex GUI · {remote ? 'Remote' : 'Local'} · SSH</header>
    <section>{remote ? <RemoteSshComposerFixture /> : <LocalComposer />}</section>
  </main></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
