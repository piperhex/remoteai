import { guiText } from "../../i18n/guiText";
import { guiApi } from "./api";
import type { ListResponse, Model } from "./types";
import { withModelCatalogTimeout } from "./modelCatalogTimeout";
import { MODEL_CATALOG_ERROR } from "../../../../../shared/remote-chat/composer";

const MAX_CATALOG_PAGES = 100;

interface CatalogHost {
  ready: () => boolean;
  accept: (models: Model[]) => void | Promise<void>;
  syncing?: (value: boolean) => void;
  failed?: (message: string) => void;
}

/** Serializes paginated reads and discards responses from a previous connection or account. */
export class GuiModelCatalog {
  private active = true;
  private generation = 0;
  private pending?: Promise<void>;
  private attempt?: AbortController;
  private invalid = false;
  private switching = 0;
  private fingerprint?: string;
  private providerSource?: () => Promise<Model[] | null>;
  constructor(private readonly host: CatalogHost) {}

  setProviderSource(source: () => Promise<Model[] | null>) { this.providerSource = source; }
  private markInvalid() { this.invalid = true; this.host.syncing?.(true); }
  guard() { const generation = this.generation; return () => !this.invalid && generation === this.generation; }

  async ready() {
    if (this.pending) await this.pending;
    if (this.invalid || this.switching) throw new Error(guiText("模型正在同步，请稍后重试。"));
  }

  /** Block sends before changing routing, including before its change event reaches the UI. */
  async switchSource<T>(switchAccount: () => Promise<T>): Promise<T> {
    if (this.switching) throw new Error(guiText("正在切换账户，请稍后重试。"));
    this.switching++; this.generation++; this.markInvalid();
    try { return await switchAccount(); }
    finally {
      this.switching--;
      await this.invalidate();
    }
  }

  refresh = (): Promise<void> => {
    if (!this.active || !this.host.ready() || this.switching) return Promise.resolve();
    if (this.pending) return this.pending;
    this.host.failed?.("");
    return this.pending = this.load().finally(() => { this.pending = undefined; });
  };

  invalidate = () => { this.generation++; this.markInvalid(); return this.refresh(); };
  activate = () => { this.active = true; };
  suspend = () => {
    this.active = false; this.generation++; this.attempt?.abort();
    this.markInvalid(); this.host.failed?.("");
  };

  private async load() {
    while (this.active && this.host.ready() && !this.switching) {
      let generation = this.generation;
      const attempt = this.attempt = new AbortController();
      const current = () => !attempt.signal.aborted && this.active && generation === this.generation;
      try {
        const models = await withModelCatalogTimeout(this.readModels(current), attempt.signal);
        if (!this.active) return;
        if (generation !== this.generation) continue;
        // The CLI can return an empty list after discovery times out; it is not a catalog update.
        if (!models.length) throw new Error(guiText(MODEL_CATALOG_ERROR));
        const fingerprint = JSON.stringify(models);
        if (!this.invalid && fingerprint === this.fingerprint) return;
        generation = ++this.generation;
        this.markInvalid();
        await withModelCatalogTimeout(Promise.resolve(this.host.accept(models)), attempt.signal);
        if (!this.active || generation !== this.generation) continue;
        this.fingerprint = fingerprint;
        this.invalid = false;
        this.host.syncing?.(false);
        return;
      } catch (error) {
        if (!this.active) return;
        if (generation !== this.generation) continue;
        this.host.failed?.(guiText("模型列表暂时无法更新，请稍后重试。"));
        throw error;
      } finally { attempt.abort(); if (this.attempt === attempt) this.attempt = undefined; }
    }
  }

  private async readModels(current: () => boolean) {
    const configured = this.providerSource ? await this.providerSource() : null;
    if (!current()) return [];
    // Refresh the CLI cache as well: running tasks also need the new models' capabilities.
    const discovered = await this.readPages(current);
    return configured ?? discovered;
  }

  private async readPages(current: () => boolean) {
    let cursor: string | undefined;
    const models: Model[] = [];
    const cursors = new Set<string>();
    let pages = 0;
    do {
      const response = await guiApi.request<ListResponse<Model>>({ operation: "models", cursor });
      if (!current()) return models;
      models.push(...response.data);
      cursor = response.nextCursor || undefined;
      if (cursor && (cursors.has(cursor) || ++pages >= MAX_CATALOG_PAGES)) {
        throw new Error(guiText("模型列表暂时无法更新，请稍后重试。"));
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return models;
  }
}
