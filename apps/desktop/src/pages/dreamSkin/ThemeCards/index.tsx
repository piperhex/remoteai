import { Button, Checkbox, Tooltip } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, CloudDownload, Eye, Github, WandSparkles } from "lucide-react";
import { useThemePreview } from './useThemePreview';
import type { Translate } from "../../../i18n";
import type {
  DreamSkinCommunityTheme,
  DreamSkinMarketTheme,
  DreamSkinStatus,
  DreamSkinThemeSummary,
} from "../../../types";
import { formatPackageBytes } from "../formatters";
import styles from "./index.module.less";

type ThemeCardProps = {
  active: boolean;
  busy: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  name: string;
  preview?: string | null;
  previewEnabled?: boolean;
  selection?: {
    label: string;
    selected: boolean;
    onChange: (selected: boolean) => void;
  };
  tone?: string;
  onApply: () => void;
  t: Translate;
};

export function ThemeCard(props: ThemeCardProps) {
  const { active, busy, description, disabled = false, id, name, preview } = props;
  const { previewEnabled = false, selection, tone, onApply, t } = props;
  const { cardRef, resolvedPreview } = useThemePreview({ id, preview, previewEnabled });
  return (
    <article ref={cardRef}
      className={`${styles.themeCard}${active ? ` ${styles.active}` : ""}${
        selection?.selected ? ` ${styles.selected}` : ""
      }`}>
      <div className={`${styles.themePreview}${tone ? "" : ` ${styles.themePreviewSaved}`}`}
        style={resolvedPreview ? { backgroundImage: `url("${resolvedPreview}")` } : undefined}>
        <div className={styles.themePreviewShade} />
        {selection && <Checkbox className={styles.themeSelection} checked={selection.selected}
          aria-label={selection.label} onChange={(event) => selection.onChange(event.target.checked)} />}
        <span className={styles.themeId}>{id}</span>
        {active && <span className={styles.themeCurrent}><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className={styles.themeCopy}>
        <div><h3>{name}</h3><p>{description}</p></div>
        <Button type={active ? "default" : "primary"} disabled={active || busy || disabled}
          loading={busy && !active} icon={active ? <Check size={14} /> : <WandSparkles size={14} />}
          onClick={onApply}>
          {active ? t("dreamSkin.applied") : t("dreamSkin.apply")}
        </Button>
      </div>
    </article>
  );
}

export function SavedThemeCard(props: {
  theme: DreamSkinThemeSummary;
  status: Pick<DreamSkinStatus, "activeThemeId"> | null;
  busy: boolean;
  disabled?: boolean;
  onApply: () => void;
  selection?: ThemeCardProps["selection"];
  t: Translate;
}) {
  const { theme, status, busy, disabled, onApply, selection, t } = props;
  return <ThemeCard active={status?.activeThemeId === theme.id} busy={busy} disabled={disabled}
    description={t("dreamSkin.saved.description")} id={theme.id} name={theme.name}
    previewEnabled onApply={onApply} selection={selection} t={t} />;
}

function InstallButton(props: {
  active: boolean;
  busy: boolean;
  installed: boolean;
  updateAvailable: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { active, busy, installed, updateAvailable, onInstall, t } = props;
  let label = installed ? t("dreamSkin.apply") : t("dreamSkin.market.installApply");
  if (active && !updateAvailable) label = t("dreamSkin.applied");
  else if (updateAvailable) label = t("dreamSkin.market.updateApply");
  return <Button type={!installed || updateAvailable ? "primary" : "default"}
    disabled={active && !updateAvailable} loading={busy}
    icon={active && !updateAvailable ? <Check size={14} /> : <CloudDownload size={14} />}
    onClick={onInstall}>
    {label}
  </Button>;
}

export function MarketThemeCard(props: {
  theme: DreamSkinMarketTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { theme, active, busy, onInstall, t } = props;
  return (
    <article className={`${styles.themeCard} ${styles.marketCard}${active ? ` ${styles.active}` : ""}`}>
      <div className={styles.themePreview} style={{ backgroundImage: `url("${theme.previewUrl}")` }}>
        <div className={styles.themePreviewShade} />
        <span className={styles.marketVersion}>v{theme.version}</span>
        {active && <span className={styles.themeCurrent}><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className={styles.marketCopy}>
        <div className={styles.marketTitleRow}>
          <div><h3>{theme.name}</h3><small>{t("dreamSkin.market.by", { author: theme.author })}</small></div>
          <Tooltip title={t("dreamSkin.market.source")}>
            <Button aria-label={t("dreamSkin.market.source")} size="small" type="text"
              icon={<Github size={15} />} onClick={() => void openUrl(theme.sourceUrl)} />
          </Tooltip>
        </div>
        <p>{theme.description}</p>
        <div className={styles.marketTags}>{theme.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <div className={styles.marketFooter}>
          <small>{theme.license}</small>
          <InstallButton active={active} busy={busy} installed={theme.installed}
            updateAvailable={theme.updateAvailable} onInstall={onInstall} t={t} />
        </div>
      </div>
    </article>
  );
}

export function CommunityThemeCard(props: {
  theme: DreamSkinCommunityTheme;
  active: boolean;
  busy: boolean;
  onInstall: () => void;
  t: Translate;
}) {
  const { theme, active, busy, onInstall, t } = props;
  const previewUrl = `https://dreamskin.cc/preview?themeVersion=${encodeURIComponent(theme.id)}`;
  return (
    <article className={`${styles.themeCard} ${styles.marketCard} ${styles.communityCard}${
      active ? ` ${styles.active}` : ""
    }`}>
      <div className={styles.themePreview} style={{ backgroundImage: `url("${theme.previewUrl}")` }}>
        <div className={styles.themePreviewShade} />
        <span className={styles.communitySource}>DreamSkin.cc</span>
        <span className={styles.marketVersion}>v{theme.version}</span>
        {active && <span className={styles.themeCurrent}><Check size={13} />{t("dreamSkin.current")}</span>}
      </div>
      <div className={styles.marketCopy}>
        <div className={styles.marketTitleRow}><div><h3 title={theme.name}>{theme.name}</h3>
          <small>{t("dreamSkin.market.by", { author: theme.authorDisplayName })}</small></div></div>
        <div className={styles.communityMeta}>
          <span>{theme.license}</span>
          <span>{t("dreamSkin.market.downloads", { count: theme.downloadCount.toLocaleString() })}</span>
          <span>{t("dreamSkin.market.packageSize", { size: formatPackageBytes(theme.packageBytes) })}</span>
        </div>
        {!theme.applyCompatible && <p>{t("dreamSkin.market.previewOnly")}</p>}
        <div className={styles.communityActions}>
          {theme.applyCompatible && <InstallButton active={active} busy={busy} installed={theme.installed}
            updateAvailable={theme.updateAvailable} onInstall={onInstall} t={t} />}
          <Button icon={<Eye size={14} />} onClick={() => void openUrl(previewUrl)}>
            {t("dreamSkin.market.onlinePreview")}
          </Button>
        </div>
      </div>
    </article>
  );
}
