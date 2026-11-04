import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountNoteModal } from '../src/components/modals/AccountNoteModal';
import { AccountDetailsSheet } from '../../web/src/components/AccountDetailsSheet';
import { ModelPicker } from '../src/pages/codexGui/ModelPicker';
import { ComposerModelPicker } from '../../../shared/remote-chat/views/ComposerModelPicker';
import { updateAccountNote } from '../src/api/backend';
import { translate } from '../src/i18n';
import { loadStoredSession } from '../../web/src/api';
import { DEMO_ACCOUNTS } from '../src/demo';
import type { ModelSelection } from '../../../shared/conversation/modelSelection';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/composer.css';
import '../../../shared/remote-chat/views/composerDesktop.css';

loadStoredSession();
const mode = new URLSearchParams(location.search).get('mode');
const slug = 'gpt-6-luna-account@example.test-9a4ad11234567890';
const account = { ...DEMO_ACCOUNTS[0], id: 'alias-fixture', email: 'account@example.test',
  privateDetails: { password: '', phoneNumber: '', totpSecret: '', alias: '' } };
const models = [{ id: slug, model: slug, displayName: 'gpt-6-luna · 工作号', isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }];

function Harness() {
  const [open, setOpen] = useState(true);
  const [selection, setSelection] = useState<ModelSelection>({ model: slug, effort: 'high' });
  return <main style={{ padding: 24 }}>
    <output data-testid="selected-model">{selection.model}</output>
    <div className="chat-composer" style={{ marginTop: 20, width: 340 }}>
      {mode === 'local' ? <ModelPicker models={models} {...selection} disabled={false} onChange={setSelection} />
        : <ComposerModelPicker models={models} selection={{ ...selection, speed: 'normal' }}
          settingsBusy={false} ready refreshModels={async () => {}} beforeOpen={() => {}}
          updateSettings={async value => setSelection(current => ({ ...current, ...value }))} />}
    </div>
    {mode === 'web' ? <AccountDetailsSheet account={open ? account : null} onClose={() => setOpen(false)}
      onUpdated={async () => {}} /> : open && <AccountNoteModal account={account} loading={false}
      t={(key, values) => translate('zh', key, values)} onClose={() => setOpen(false)}
      onSave={async details => { await updateAccountNote(account.id, details); return true; }} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
