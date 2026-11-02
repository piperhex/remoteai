import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeRelay } = require('../../../shared/remote-chat/relayWire') as
  typeof import('../../../shared/remote-chat/relayWire');
const { DEFAULT_CHAT_POLICY } = require('../../../shared/chat/chatPolicy') as
  typeof import('../../../shared/chat/chatPolicy');

interface Endpoint { route: WebSocketRoute; key: string; device: string }
interface Search { target: Endpoint; fileId: string; id: string; candidates: Set<Endpoint> }

/** Coordinator fixture; production ChatLink encryption, WebRTC, chunking and download sinks remain real. */
export class AttachmentBroker {
  constructor(private readonly policy: Partial<typeof DEFAULT_CHAT_POLICY> = {}) {}
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly pairs = new Map<string, [Endpoint, Endpoint]>();
  private readonly searches = new Map<string, Search>();
  recoveryRequests = 0;
  relayFrames = 0;
  signalFrames = 0;
  readonly events: string[] = [];
  updatePolicy(changes: Partial<typeof DEFAULT_CHAT_POLICY>) {
    Object.assign(this.policy, changes);
    for (const endpoint of this.endpoints.values()) endpoint.route.send(JSON.stringify({
      type: 'chat-policy', policy: { ...DEFAULT_CHAT_POLICY, ...this.policy },
    }));
  }
  async install(context: BrowserContext) {
    await context.routeWebSocket('**/device-chat', route => {
      let endpoint: Endpoint;
      route.onClose(() => {
        if (endpoint) this.endpoints.delete(endpoint.device);
        for (const [id, pair] of this.pairs) if (pair.includes(endpoint)) this.pairs.delete(id);
      });
      route.onMessage(raw => {
        const data = typeof raw === 'string' ? raw : decodeRelay(new Uint8Array(raw).buffer);
        const frame = JSON.parse(data);
        this.events.push(frame.type);
        if (this.events.length > 100) this.events.shift();
        const send = (target: WebSocketRoute, value: object) => target.send(JSON.stringify(value));
        if (frame.type === 'authenticate') {
          endpoint = { route, key: frame.publicKey, device: frame.deviceId };
          this.endpoints.set(endpoint.device, endpoint);
          send(route, { type: 'chat-policy', policy: { ...DEFAULT_CHAT_POLICY, ...this.policy } });
          send(route, { type: 'sync-registered' }); return;
        }
        if (frame.type === 'renew-auth') { send(route, { type: 'auth-renewed' }); return; }
        if (frame.type === 'attachment-connect') {
          const grant = JSON.parse(frame.grant);
          const source = this.endpoints.get(grant.device);
          if (source) this.pair(source, { target: endpoint, id: frame.id, fileId: grant.id, candidates: new Set() });
          else this.locate(endpoint, frame.id, grant.id);
          return;
        }
        if (frame.type === 'attachment-available') {
          const search = this.searches.get(frame.id);
          if (!search?.candidates.delete(endpoint)) return;
          if (frame.available) { this.searches.delete(frame.id); this.pair(endpoint, search); }
          else if (!search.candidates.size) {
            this.searches.delete(frame.id);
            send(search.target.route, { type: 'attachment-unavailable', id: search.id });
          }
          return;
        }
        const pair = this.pairs.get(frame.sessionId);
        if (!pair) return;
        if (frame.type === 'relay') this.relayFrames++;
        if (frame.type === 'signal') this.signalFrames++;
        send(pair[0] === endpoint ? pair[1].route : pair[0].route, frame);
        if (frame.type === 'peer-close') this.pairs.delete(frame.sessionId);
      });
    });
  }
  private pair(source: Endpoint, search: Search) {
    const { target, id, fileId } = search;
    const sessionId = crypto.randomUUID(); this.pairs.set(sessionId, [source, target]);
    const common = { type: 'attachment-peer', sessionId, id, fileId,
      expiresAt: Date.now() + 600_000, iceServers: [] };
    source.route.send(JSON.stringify({ ...common, desktop: true, publicKey: target.key }));
    target.route.send(JSON.stringify({ ...common, desktop: false, publicKey: source.key }));
  }
  private locate(target: Endpoint, id: string, fileId: string) {
    this.recoveryRequests++;
    const candidates = new Set([...this.endpoints.values()].filter(endpoint => endpoint !== target));
    if (!candidates.size) {
      target.route.send(JSON.stringify({ type: 'attachment-unavailable', id })); return;
    }
    const query = crypto.randomUUID(); this.searches.set(query, { target, id, fileId, candidates });
    for (const source of candidates) source.route.send(JSON.stringify({ type: 'attachment-locate', id: query, fileId }));
  }
}
