/**
 * Typed WebSocket client for the authoritative battle server.
 *
 * Sends `ClientMessage`s and dispatches incoming `ServerMessage`s to handlers
 * registered per message `type`. The server is authoritative; this client only
 * transports intent and receives state/resolutions.
 */

import type {
  ClientMessage,
  ServerMessage,
  ActionOrder,
} from '../../shared/index.ts';

type ServerMessageOfType<T extends ServerMessage['type']> = Extract<
  ServerMessage,
  { type: T }
>;

type Handler<T extends ServerMessage['type']> = (msg: ServerMessageOfType<T>) => void;

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers = new Map<string, Set<(msg: ServerMessage) => void>>();
  private statusCbs = new Set<(s: ConnectionStatus) => void>();
  private _status: ConnectionStatus = 'idle';
  private queued: ClientMessage[] = [];

  constructor(url?: string) {
    this.url = url ?? `ws://${location.hostname || 'localhost'}:8080`;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  private setStatus(s: ConnectionStatus): void {
    this._status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        this.setStatus('open');
        for (const m of this.queued) this.rawSend(m);
        this.queued = [];
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      ws.onerror = () => {
        this.setStatus('error');
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket connection failed'));
        }
      };
      ws.onclose = () => {
        this.setStatus('closed');
      };
      ws.onmessage = (ev: MessageEvent) => {
        this.dispatch(ev.data as string);
      };
    });
  }

  private dispatch(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      console.warn('[net] malformed server message', raw);
      return;
    }
    const set = this.handlers.get(msg.type);
    if (set) for (const cb of set) cb(msg);
    const all = this.handlers.get('*');
    if (all) for (const cb of all) cb(msg);
  }

  /** Register a typed handler for a specific server message type. Returns unsubscribe. */
  on<T extends ServerMessage['type']>(type: T, handler: Handler<T>): () => void {
    const wrapped = handler as (msg: ServerMessage) => void;
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  /** Listen to every message (debugging / logging). */
  onAny(handler: (msg: ServerMessage) => void): () => void {
    let set = this.handlers.get('*');
    if (!set) {
      set = new Set();
      this.handlers.set('*', set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.rawSend(msg);
    } else {
      this.queued.push(msg);
    }
  }

  private rawSend(msg: ClientMessage): void {
    this.ws!.send(JSON.stringify(msg));
  }

  // ── Typed convenience senders ──
  join(sessionId?: string): void {
    this.send(sessionId ? { type: 'join', sessionId } : { type: 'join' });
  }
  selectPokemon(species: string): void {
    this.send({ type: 'selectPokemon', species });
  }
  selectMoves(moveIds: string[]): void {
    this.send({ type: 'selectMoves', moveIds });
  }
  declare(
    moveId: string,
    targetTile: [number, number] | null,
    movePath: [number, number][],
    actionOrder: ActionOrder,
  ): void {
    this.send({ type: 'declare', moveId, targetTile, movePath, actionOrder });
  }
  forfeit(): void {
    this.send({ type: 'forfeit' });
  }
  ping(): void {
    this.send({ type: 'ping' });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
