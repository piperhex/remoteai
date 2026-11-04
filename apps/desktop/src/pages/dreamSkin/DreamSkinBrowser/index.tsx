import { Alert, Button } from "antd";
import { useEffect } from 'react';
import { ImagePlus, RefreshCw, WandSparkles } from "lucide-react";
import { BUILT_IN_DREAM_SKIN_THEMES } from "../../../dreamSkinBuiltIns";
import type { Translate } from "../../../i18n";
import type { DreamSkinStatus, DreamSkinThemeSummary } from "../../../types";
import type { CatalogState, SavedThemeLibrary, ThemeActions, ThemeTab } from "../types";
import { CommunityThemeCard, MarketThemeCard, SavedThemeCard, ThemeCard } from "../ThemeCards";
import { themeThumbnails } from '../ThemeCards/themeThumbnails';
import styles from "./index.module.less";

type Props = {
  actions: Pick<ThemeActions, "applyTheme" | "installAndApplyCommunityTheme" | "installAndApplyMarketTheme">;
  busy: string | null;
  builtInQuery: string;
  catalog: CatalogState;
  chooseCustomImage?: () => Promise<void>;
  isBusy: boolean;
  resourcesReady: boolean;
  savedLibrary?: SavedThemeLibrary;
  savedQuery?: string;
  savedThemes: DreamSkinThemeSummary[];
  status: Pick<DreamSkinStatus, "installed" | "activeThemeId"> | null;
  showInstallHint?: boolean;
  t: Translate;
  themeTab: ThemeTab;
};

export function DreamSkinBrowser(props: Props) {
  useEffect(() => themeThumbnails.retain(), []);
  const { status, t, themeTab } = props;
  return <>
    {props.showInstallHint !== false && !status?.installed && <Alert className={styles.prerequisite} type="info" showIcon
      message={t("dreamSkin.installHint.title")} description={t("dreamSkin.installHint.description")} />}
    <section className={styles.browser}>
      {themeTab === "builtIn" ? <BuiltInThemes {...props} />
        : themeTab === "market" ? <MarketThemes {...props} /> : <SavedThemes {...props} />}
    </section>
  </>;
}

function BuiltInThemes(props: Props) {
  const { actions, busy, builtInQuery, chooseCustomImage, isBusy, resourcesReady, status, t } = props;
  const query = builtInQuery.trim().toLocaleLowerCase();
  const themes = BUILT_IN_DREAM_SKIN_THEMES.filter((theme) => !query
    || [t(theme.nameKey), t(theme.descriptionKey), theme.id]
      .some((value) => value.toLocaleLowerCase().includes(query)));
  return <div className={styles.themeGrid} role="tabpanel" aria-label={t("dreamSkin.tabs.builtIn")}>
    {themes.map((theme) => <ThemeCard key={theme.id}
      active={status?.activeThemeId === theme.id} busy={busy === `apply:${theme.id}`}
      disabled={!resourcesReady || isBusy} description={t(theme.descriptionKey)} id={theme.id} name={t(theme.nameKey)}
      previewEnabled={resourcesReady} tone={theme.tone} onApply={() => actions.applyTheme(theme.id)} t={t} />)}
    {themes.length === 0 && <div className={`${styles.marketEmpty} ${styles.themeEmpty}`}>
      {t("dreamSkin.presets.empty")}
    </div>}
    {chooseCustomImage && <article className={styles.themeImportCard}>
      <button type="button" className={styles.importTrigger} disabled={isBusy}
        onClick={() => void chooseCustomImage()}>
        <span className={styles.importIcon}><ImagePlus size={28} /></span>
        <span><b>{t("dreamSkin.import.title")}</b><small>{t("dreamSkin.import.description")}</small></span>
        <em><WandSparkles size={15} />{t("dreamSkin.import.action")}</em>
      </button>
    </article>}
  </div>;
}

function MarketThemes(props: Props) {
  const { actions, busy, catalog, status, t } = props;
  const hasThemes = catalog.filteredMarketThemes.length + catalog.filteredCommunityThemes.length > 0;
  const initiallyLoading = catalog.marketLoading && !catalog.market
    && catalog.communityLoading && !catalog.communityInitialized;
  let themeContent = <div className={styles.marketEmpty}>{t("dreamSkin.market.empty")}</div>;
  if (initiallyLoading) {
    themeContent = <div className={styles.marketLoading}><RefreshCw className="spin" size={20} />
      {t("dreamSkin.market.loading")}</div>;
  } else if (hasThemes) {
    themeContent = <div className={styles.themeGrid}>
      {catalog.filteredMarketThemes.map((theme) => <MarketThemeCard key={theme.id} theme={theme}
        active={status?.activeThemeId === theme.id} busy={busy === `market:${theme.id}`}
        onInstall={() => actions.installAndApplyMarketTheme(theme)} t={t} />)}
      {catalog.filteredCommunityThemes.map((theme) => <CommunityThemeCard key={theme.id} theme={theme}
        active={status?.activeThemeId === theme.themeId} busy={busy === `community:${theme.id}`}
        onInstall={() => actions.installAndApplyCommunityTheme(theme)} t={t} />)}
    </div>;
  }
  return <div className={styles.marketPane} role="tabpanel" aria-label={t("dreamSkin.tabs.market")}>
    {(catalog.market?.cached || catalog.market?.warning) && <Alert showIcon type="warning"
      message={t("dreamSkin.market.cached")} description={catalog.market.warning} />}
    {catalog.communityWarning && <Alert showIcon type="warning"
      message={t("dreamSkin.market.communityCached")} description={catalog.communityWarning} />}
    {catalog.marketError && <Alert showIcon type="error" message={t("dreamSkin.market.failed")}
      description={catalog.marketError} action={<Button size="small" onClick={() => void catalog.refreshMarket()}>
        {t("dreamSkin.market.retry")}</Button>} />}
    {catalog.communityError && <Alert showIcon type="error" message={t("dreamSkin.market.communityFailed")}
      description={catalog.communityError} action={<Button size="small"
        onClick={() => void catalog.loadCommunityThemes()}>{t("dreamSkin.market.retry")}</Button>} />}
    {themeContent}
    <MarketSentinel catalog={catalog} t={t} />
  </div>;
}

function MarketSentinel({ catalog, t }: Pick<Props, "catalog" | "t">) {
  const initialLoading = catalog.marketLoading && !catalog.market
    && catalog.communityLoading && !catalog.communityInitialized;
  if (initialLoading) return null;

  let content = null;
  if (catalog.communityLoading) {
    content = <><RefreshCw className="spin" size={15} />{t("dreamSkin.market.loadingMore")}</>;
  } else if (catalog.communityError) {
    content = <Button size="small" onClick={() => void catalog.loadCommunityThemes()}>
      {t("dreamSkin.market.retryApi")}</Button>;
  } else if (catalog.communityInitialized && catalog.communityHasMore) {
    content = t("dreamSkin.market.scrollForMore");
  } else if (catalog.communityInitialized) {
    content = t("dreamSkin.market.allLoaded", { count: catalog.communityThemes.length });
  }
  return <div ref={catalog.communitySentinelRef} className={styles.marketSentinel} aria-live="polite">
    {content}
  </div>;
}

function SavedThemes(props: Props) {
  const { actions, busy, savedLibrary, savedThemes, status, t } = props;
  if (savedThemes.length === 0) {
    return <div className={styles.marketEmpty} role="tabpanel"
      aria-label={t("dreamSkin.tabs.savedCommunity")}>{t("dreamSkin.saved.empty")}</div>;
  }
  const query = (savedLibrary?.query ?? props.savedQuery ?? "").trim().toLocaleLowerCase();
  const filteredThemes = savedThemes.filter((theme) => !query
    || [theme.name, theme.id].some((value) => value.toLocaleLowerCase().includes(query)));
  return <div className={styles.themeGrid} role="tabpanel"
    aria-label={t("dreamSkin.tabs.savedCommunity")}>
    {filteredThemes.map((theme) => <SavedThemeCard key={theme.id} theme={theme} status={status}
      busy={busy === `apply:${theme.id}`} disabled={props.isBusy} onApply={() => actions.applyTheme(theme.id)} t={t}
      selection={savedLibrary ? {
        label: t("dreamSkin.saved.select", { name: theme.name }),
        selected: savedLibrary.selectedThemeIds.includes(theme.id),
        onChange: (selected) => savedLibrary.toggleTheme(theme.id, selected),
      } : undefined} />)}
    {filteredThemes.length === 0
      && <div className={`${styles.marketEmpty} ${styles.themeEmpty}`}>{t("dreamSkin.saved.searchEmpty")}</div>}
  </div>;
}
