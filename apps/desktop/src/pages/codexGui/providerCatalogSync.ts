import { guiApi } from '../../../../../shared/conversation/api';
import { withModelCatalogTimeout } from './modelCatalogTimeout';
import type { ListResponse, Model } from '../../../../../shared/conversation/types';

const PROVIDER_DISCOVERY_WAIT_MS = 3000;

/** Configuration is authoritative; refresh CLI capabilities without blocking the picker indefinitely. */
export class ProviderCatalogSync {
  private generation = 0;
  private pending?: { generation: number; request: Promise<boolean> };

  invalidate() { this.generation++; }

  async refresh(signal: AbortSignal): Promise<boolean> {
    const generation = this.generation;
    if (!this.pending) {
      const request = guiApi.request<ListResponse<Model>>({ operation: 'models' })
        .then(response => response.data.length > 0).catch(() => false);
      const pending = this.pending = { generation, request };
      void request.finally(() => { if (this.pending === pending) this.pending = undefined; });
    }
    const pending = this.pending;
    try {
      const updated = await withModelCatalogTimeout(pending.request, signal, PROVIDER_DISCOVERY_WAIT_MS);
      return updated && generation === this.generation && pending.generation === generation;
    } catch {
      // The caller retains configured models and schedules another single-flight capability refresh.
      return false;
    }
  }
}
