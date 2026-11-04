import { uiText } from "../../../../../shared/localization/uiText";
import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiController } from './controller';
import { modelSelectionError, resolveModelSelection } from '../../../../../shared/conversation/modelSelection';
import type { Model, ListResponse } from '../../../../../shared/conversation/types';
import { composerPatch, DEFAULT_COMPOSER, MODEL_CATALOG_ERROR, type ComposerSettings,
  type ComposerSnapshot, type RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { guiRequestSpeed, type RequestSpeedSource } from './requestSpeedBridge';

type Binding = Pick<GuiController, 'getSnapshot' | 'subscribe' | 'settings' | 'modelCatalog' | 'modelSettings'>;
const MAX_OBSERVED_CONVERSATIONS = 128;

/** Owns the small shared composer state while the main GUI is mounted or the phone is its only client. */
export class ComposerBridge {
  private binding?: Binding;
  private value: ComposerSnapshot = { models: [], settings: { ...DEFAULT_COMPOSER }, revision: 0 };
  private readonly listeners = new Set<(snapshot: ComposerSnapshot) => void>();
  private loading?: Promise<void>;
  private pendingSettings = false;
  private unsubscribeSpeed?: () => void;
  private revision = 0;
  private scoped = new Map<string | null, ComposerSnapshot>();

  constructor(private readonly speed?: RequestSpeedSource) {}

  subscribe = (listener: (snapshot: ComposerSnapshot) => void) => {
    this.listeners.add(listener);
    this.unsubscribeSpeed ??= this.speed?.subscribe((speed) => this.publishSpeed(speed));
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.unsubscribeSpeed?.(); this.unsubscribeSpeed = undefined; }
    };
  };

  attach(binding: Binding) {
    this.binding = binding;
    if (this.pendingSettings) {
      const { model, effort, access } = this.value.settings;
      binding.settings({ model, effort, access });
    }
    this.pendingSettings = false;
    const update = () => {
      const { models, settings, modelCatalogLoading } = binding.getSnapshot();
      this.publish(models, settings, Boolean(modelCatalogLoading));
    };
    update();
    const unsubscribe = binding.subscribe(update);
    const unwatch = binding.modelSettings.watch(() => this.publishScopes());
    return () => { unsubscribe(); unwatch(); if (this.binding === binding) this.binding = undefined; };
  }

  private publish(models: Model[], selection: ComposerSettings, syncing = false) {
    const settings = { ...resolveModelSelection(models, selection), access: selection.access,
      ...(this.value.settings.speed ? { speed: this.value.settings.speed } : {}) };
    if (models === this.value.models && settings.model === this.value.settings.model
      && settings.effort === this.value.settings.effort && settings.access === this.value.settings.access
      && syncing === Boolean(this.value.syncing)) return;
    this.value = { models, settings, syncing, revision: ++this.revision };
    for (const listener of this.listeners) listener(this.value);
    this.publishScopes();
  }

  private publishSpeed(speed: RequestSpeed) {
    if (speed === this.value.settings.speed) return;
    this.value = { ...this.value, settings: { ...this.value.settings, speed }, revision: ++this.revision };
    for (const listener of this.listeners) listener(this.value);
    this.publishScopes();
  }

  private publishScope(threadId: string | null): ComposerSnapshot {
    const selection = this.binding!.modelSettings.selection(threadId);
    const settings = { ...this.value.settings, ...selection };
    const syncing = Boolean(this.value.syncing || this.binding!.modelSettings.loading(threadId));
    const previous = this.scoped.get(threadId);
    if (previous && previous.models === this.value.models && previous.syncing === syncing
      && Object.keys(settings).every((key) => settings[key as keyof ComposerSettings]
        === previous.settings[key as keyof ComposerSettings])) return previous;
    const snapshot = { models: this.value.models, settings, syncing, threadId, revision: ++this.revision };
    this.scoped.set(threadId, snapshot);
    if (this.scoped.size > MAX_OBSERVED_CONVERSATIONS) this.scoped.delete(this.scoped.keys().next().value!);
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  private publishScopes() {
    if (!this.binding) return;
    for (const threadId of this.scoped.keys()) {
      this.publishScope(threadId);
    }
  }

  private async loadModels() {
    const models: Model[] = [];
    let cursor: string | undefined;
    do {
      const result = await guiApi.request<ListResponse<Model>>({ operation: 'models', cursor, cacheOnly: true });
      models.push(...result.data);
      cursor = result.nextCursor || undefined;
    } while (cursor);
    if (!models.length) throw new Error(uiText(MODEL_CATALOG_ERROR));
    if (!this.binding) this.publish(models, this.value.settings);
  }

  private async readSelection() {
    const current = this.binding?.getSnapshot();
    if (current) this.publish(current.models, current.settings, Boolean(current.modelCatalogLoading));
    else {
      this.loading ??= this.loadModels().finally(() => { this.loading = undefined; });
      await this.loading;
    }
  }

  async read(threadId?: string | null): Promise<ComposerSnapshot> {
    if (threadId !== undefined && !this.binding) throw new Error(uiText("client.composer.theComputerIsNotReadyYetPleaseTryAgainShortly"));
    await this.binding?.modelCatalog.recover();
    await Promise.all([this.readSelection(), this.speed?.read().then((speed) => this.publishSpeed(speed))
      .catch(() => { /* Model selection stays usable if the host cannot report its speed yet. */ }),
      threadId !== undefined ? this.binding!.modelSettings.ready(threadId) : undefined]);
    if (threadId !== undefined && !this.binding) throw new Error(uiText("client.composer.theComputerIsNotReadyYetPleaseTryAgainShortly"));
    await this.binding?.modelCatalog.ready();
    return threadId === undefined ? this.value : this.publishScope(threadId);
  }

  /** Discovery is an explicit remote action, separate from passive reads and polling. */
  async refreshModels(threadId?: string | null): Promise<ComposerSnapshot> {
    if (!this.binding) throw new Error(uiText("client.composer.theComputerIsNotReadyYetPleaseTryAgainShortly"));
    await this.binding.modelCatalog.refresh();
    return this.read(threadId);
  }

  async update(input: unknown, threadId?: string | null): Promise<ComposerSnapshot> {
    const patch = composerPatch(input);
    const current = await this.read(threadId);
    const currentCatalog = this.binding?.modelCatalog.guard();
    const selected = current.models.find((model) => model.model === (patch.model ?? current.settings.model));
    if (!selected) throw new Error(uiText("client.composer.thisModelIsNoLongerAvailablePleaseChooseAnother"));
    const efforts = selected.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
    if (!efforts.length) efforts.push(resolveModelSelection([selected], { model: selected.model, effort: '' }).effort);
    if (patch.effort && !efforts.includes(patch.effort)) {
      throw new Error(uiText("client.composer.thisModelDoesNotSupportTheSelectedReasoningEffortPlease"));
    }
    const settings = { ...current.settings, ...patch,
      ...(patch.model && patch.model !== current.settings.model && patch.effort === undefined ? { effort: '' } : {}) };
    const normalized = { ...resolveModelSelection(current.models, settings), access: settings.access };
    if (patch.speed !== undefined) {
      if (!this.speed) throw new Error(uiText("client.composer.updateTheDesktopAppBeforeChangingTheSpeedMode"));
      if (patch.speed !== current.settings.speed) this.publishSpeed(await this.speed.set(patch.speed));
    }
    if (patch.model !== undefined || patch.effort !== undefined || patch.access !== undefined) {
      if (currentCatalog && !currentCatalog()) throw new Error(uiText("client.composer.theModelHasChangedReviewItAndChooseAgain"));
      if (threadId !== undefined) {
        if (!this.binding) throw new Error(uiText("client.composer.theComputerIsNotReadyYetPleaseTryAgainShortly"));
        if (patch.access !== undefined) this.binding.settings({ access: patch.access });
        if (patch.model !== undefined || patch.effort !== undefined) {
          this.binding.modelSettings.change({ model: normalized.model, effort: normalized.effort }, threadId);
          await this.binding.modelSettings.ready(threadId);
        }
      } else if (this.binding) this.binding.settings(normalized);
      else this.pendingSettings = true;
      if (threadId === undefined) this.publish(current.models, normalized);
    }
    return threadId === undefined ? this.value : this.publishScope(threadId);
  }

  async validateSend(body: { threadId?: string; model?: string; effort?: string }) {
    const snapshot = await this.read(body.threadId ?? null);
    const error = modelSelectionError(snapshot.models, snapshot.settings);
    if (error) throw new Error(uiText(error));
    if (snapshot.syncing || !snapshot.models.length || (body.model && body.model !== snapshot.settings.model)
      || (body.effort && body.effort !== snapshot.settings.effort)) {
      throw new Error(uiText("client.composer.theModelHasChangedReviewItAndSendAgain"));
    }
    return snapshot.settings;
  }
}

export const guiComposer = new ComposerBridge(guiRequestSpeed);
