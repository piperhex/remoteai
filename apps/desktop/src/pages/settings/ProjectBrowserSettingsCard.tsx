import { displayText } from '../../../../../shared/localization/uiText';
import { FolderSearch } from 'lucide-react';
import { AutoSaveSettings } from '../../../../../shared/project-browser/AutoSaveSettings';
import { JsonHighlightSettings } from '../../../../../shared/file-preview/JsonHighlightSettings';
import { useBrowserPreferences } from '../../../../../shared/project-browser/useBrowserPreferences';
import { t, useLanguage } from '../../../../../shared/localization/browserClient';

export function ProjectBrowserSettingsCard() {
  useLanguage();
  const preferences = useBrowserPreferences();
  return <section className="settings-card">
    <div className="settings-icon"><FolderSearch size={23} /></div>
    <div className="settings-card-content"><div className="settings-card-copy">
      <h3>{t("client.projectBrowser.browseFiles")}</h3><AutoSaveSettings preferences={preferences} t={displayText} />
      <JsonHighlightSettings t={displayText} />
    </div></div>
  </section>;
}
