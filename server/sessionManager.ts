/**
 * SessionManager — matchmaking and session lifecycle.
 *
 * Holds the live map of sessionId -> GameSession, routes incoming sockets to a
 * session (quick-match or by explicit code), and forwards subsequent messages
 * to the owning session. Cleans up finished / empty sessions.
 */

import type { WebSocket } from 'ws';
import { GameSession } from './gameSession.ts';

export class SessionManager {
  private sessions = new Map<string, GameSession>();
  /** Insertion-ordered creation, so "oldest open session" is deterministic. */
  private order: string[] = [];
  /** Reverse index: socket -> owning session, for message/close routing. */
  private socketSession = new WeakMap<WebSocket, GameSession>();

  /** Register a brand-new connection. It is not placed until it sends `join`. */
  handleConnection(ws: WebSocket): void {
    console.log('[manager] connection opened');

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString();
      this.route(ws, raw);
    });

    ws.on('close', () => {
      console.log('[manager] connection closed');
      const session = this.socketSession.get(ws);
      if (session) session.handleDisconnect(ws);
    });

    ws.on('error', (err: Error) => {
      console.log(`[manager] socket error: ${err.message}`);
    });
  }

  private route(ws: WebSocket, raw: string): void {
    const existing = this.socketSession.get(ws);
    if (existing) {
      existing.handleMessage(ws, raw);
      return;
    }
    // Not yet placed — the first legal message must be a `join`.
    let parsed: { type?: string; sessionId?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.safeSend(ws, { type: 'error', message: 'Malformed JSON.' });
      return;
    }
    if (parsed?.type !== 'join') {
      this.safeSend(ws, { type: 'error', message: 'Send a join message first.' });
      return;
    }
    this.placePlayer(ws, parsed.sessionId);
  }

  /** Matchmaking: attach the socket to an existing or new GameSession. */
  private placePlayer(ws: WebSocket, requestedId?: string): void {
    let session: GameSession | undefined;

    if (requestedId) {
      session = this.sessions.get(requestedId);
      if (!session) {
        this.safeSend(ws, { type: 'error', message: `Session '${requestedId}' not found.` });
        return;
      }
      if (!session.isJoinable) {
        this.safeSend(ws, { type: 'error', message: `Session '${requestedId}' is full or already started.` });
        return;
      }
    } else {
      // Quick-match: oldest joinable session, else create a new one.
      session = this.oldestJoinable();
      if (!session) {
        session = this.createSession();
      }
    }

    this.socketSession.set(ws, session);
    session.addPlayer(ws);
  }

  private oldestJoinable(): GameSession | undefined {
    for (const id of this.order) {
      const s = this.sessions.get(id);
      if (s && s.isJoinable) return s;
    }
    return undefined;
  }

  private createSession(): GameSession {
    let id = randomSessionId();
    while (this.sessions.has(id)) id = randomSessionId();
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const session = new GameSession(id, seed);
    session.onEnded = (s) => this.removeSession(s);
    this.sessions.set(id, session);
    this.order.push(id);
    console.log(`[manager] created session ${id} (seed ${seed})`);
    return session;
  }

  private removeSession(session: GameSession): void {
    if (!this.sessions.has(session.sessionId)) return;
    this.sessions.delete(session.sessionId);
    this.order = this.order.filter((id) => id !== session.sessionId);
    console.log(`[manager] removed session ${session.sessionId} (${this.sessions.size} active)`);
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  private safeSend(ws: WebSocket, msg: unknown): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

/** Stable random 8-char session id (lowercase alphanumeric, no ambiguous chars). */
function randomSessionId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
