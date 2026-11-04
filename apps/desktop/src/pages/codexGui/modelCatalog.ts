import { uiText } from "../../../../../shared/localization/uiText";
import { guiApi } from "../../../../../shared/conversation/api";
import type { ListResponse, Model } from "../../../../../shared/conversation/types";
import { withModelCatalogTimeout } from "./modelCatalogTimeout";
import { MODEL_CATALOG_ERROR } from "../../../../../shared/remote-chat/composer";
import { ProviderCatalogSync } from "./providerCatalogSync";

const MAX_CATALOG_PAGES = 100;
export const MODEL_CATALOG_RETRY_MS = 3000;
const MAX_RETRY_DELAY_MS = 30_000;

interface CatalogHost {
  ready: () => boolean;
  accept: (models: Model[]) => void | Promise<void>;
  syncing?: (value: boolean) => void;
  failed?: (message: string) => void;
  recovered?: () => void;
}

/** Serializes paginated reads and discards responses from a previous connection or account. */
export class GuiModelCatalog {
  private active = true;
  private generation = 0;
  private pending?: Promise<void>;
  private attempt?: AbortController;
  private invalid = false;
  private cacheOnly = false;
  private switching = 0;
  private fingerprint?: string;
  private providerSource?: () => Promise<Model[] | null>;
  private readonly providerSync = new ProviderCatalogSync();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = MODEL_CATALOG_RETRY_MS;
  constructor(private readonly host: CatalogHost) {}

  setProviderSource(source: () => Promise<Model[] | null>) { this.providerSource = source; }
  private markInvalid() { this.invalid = true; this.host.syncing?.(true); }
  guard() { const generation = this.generation; return () => !this.invalid && generation === this.generation; }

  async ready() {
    // A refresh of the same source must not hide an already usable catalog.
    if (this.pending && (this.invalid || !this.fingerprint)) await this.pending;
    if (this.invalid || this.switching) throw new Error(uiText("client.conversation.modelsAreSyncingPleaseTryAgainShortly"));
  }

  /** Remote reads can recover a failed host without reconnecting or invalidating a usable catalog. */
  async recover() {
    if (this.invalid && !this.cacheOnly && !this.pending && !this.switching) await this.refresh();
    await this.ready();
  }

  /** Block sends before changing routing, including before its change event reaches the UI. */
  async switchSource<T>(switchAccount: () => Promise<T>): Promise<T> {
    if (this.switching) throw new Error(uiText("client.conversation.switchingAccountsPleaseTryAgainShortly"));
    this.switching++; this.generation++; this.markInvalid();
    try { return await switchAccount(); }
    finally {
      this.switching--;
      await this.invalidate();
    }
  }

  /** Connections restore local data without starting discovery or failure retries. */
  restore = (): Promise<void> => {
    this.clearRetry(); this.cacheOnly = true; this.generation++; this.markInvalid();
    return this.loadCurrent();
  };

  refresh = (): Promise<void> => {
    if (this.cacheOnly && this.pending) this.generation++;
    this.cacheOnly = false; return this.loadCurrent();
  };

  private loadCurrent = (): Promise<void> => {
    if (!this.active || !this.host.ready() || this.switching) return Promise.resolve();
    if (this.pending) return this.pending;
    this.clearRetry();
    this.host.failed?.("");
    return this.pending = this.load().then(retry => {
      if (this.active && !this.invalid) this.host.recovered?.();
      if (retry) this.scheduleRetry();
      else this.retryDelay = MODEL_CATALOG_RETRY_MS;
    }, error => {
      if (!this.cacheOnly) this.scheduleRetry();
      else this.host.syncing?.(false);
      throw error;
    }).finally(() => { this.pending = undefined; });
  };

  invalidate = () => {
    this.generation++; this.providerSync.invalidate(); this.retryDelay = MODEL_CATALOG_RETRY_MS;
    this.markInvalid(); return this.refresh();
  };
  activate = () => { this.active = true; };
  suspend = () => {
    this.active = false; this.generation++; this.attempt?.abort();
    this.clearRetry(); this.providerSync.invalidate(); this.retryDelay = MODEL_CATALOG_RETRY_MS;
    this.markInvalid(); this.host.failed?.("");
  };

  private clearRetry() { clearTimeout(this.retryTimer); this.retryTimer = undefined; }

  private scheduleRetry() {
    if (this.cacheOnly || !this.active || !this.host.ready() || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.refresh().catch(() => { /* The catalog error remains visible while recovery continues. */ });
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  private async load() {
    while (this.active && this.host.ready() && !this.switching) {
      let generation = this.generation;
      const cacheOnly = this.cacheOnly;
      const attempt = this.attempt = new AbortController();
      const current = () => !attempt.signal.aborted && this.active && generation === this.generation;
      try {
        const { models, retry } = await withModelCatalogTimeout(
          this.readModels(current, attempt.signal, cacheOnly), attempt.signal,
        );
        if (!this.active) return;
        if (generation !== this.generation) continue;
        // The CLI can return an empty list after discovery times out; it is not a catalog update.
        if (!models.length && !cacheOnly) throw new Error(uiText(MODEL_CATALOG_ERROR));
        const fingerprint = JSON.stringify(models);
        if (!this.invalid && fingerprint === this.fingerprint) return retry;
        generation = ++this.generation;
        this.markInvalid();
        await withModelCatalogTimeout(Promise.resolve(this.host.accept(models)), attempt.signal);
        if (!this.active || generation !== this.generation) continue;
        this.fingerprint = fingerprint;
        this.invalid = !models.length;
        this.host.syncing?.(false);
        return retry;
      } catch (error) {
        if (!this.active) return;
        if (generation !== this.generation) continue;
        if (cacheOnly) {
          await withModelCatalogTimeout(Promise.resolve(this.host.accept([])), attempt.signal);
          if (!current()) continue;
        }
        this.host.failed?.(uiText("client.conversation.couldNotUpdateTheModelListPleaseTryAgainShortly"));
        throw error;
      } finally { attempt.abort(); if (this.attempt === attempt) this.attempt = undefined; }
    }
  }

  private async readModels(current: () => boolean, signal: AbortSignal, cacheOnly: boolean) {
    const configured = this.providerSource ? await this.providerSource() : null;
    if (!current()) return { models: [], retry: false };
    if (configured !== null) {
      const updated = configured.length && !cacheOnly ? await this.providerSync.refresh(signal) : true;
      return { models: configured, retry: !updated };
    }
    return { models: await this.readPages(current, cacheOnly), retry: false };
  }

  private async readPages(current: () => boolean, cacheOnly: boolean) {
    let cursor: string | undefined;
    const models: Model[] = [];
    const cursors = new Set<string>();
    let pages = 0;
    do {
      const response = await guiApi.request<ListResponse<Model>>({ operation: "models", cursor,
        ...(cacheOnly ? { cacheOnly: true } : {}) });
      if (!current()) return models;
      models.push(...response.data);
      cursor = response.nextCursor || undefined;
      if (cursor && (cursors.has(cursor) || ++pages >= MAX_CATALOG_PAGES)) {
        throw new Error(uiText("client.conversation.couldNotUpdateTheModelListPleaseTryAgainShortly"));
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return models;
  }
}
