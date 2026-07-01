/**
 * Hermetic integration test: boots the real WebSocket server on an ephemeral
 * port, connects two `ws` clients, and drives a full happy-path battle turn,
 * asserting the server message sequence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../src/shared/index.ts';

// Prevent the module-level auto-start on port 8080; we start our own on port 0.
process.env.GAME_SERVER_NO_AUTOSTART = '1';

let startServer: (typeof import('../index.ts'))['startServer'];
let server: { close: () => Promise<void>; port: number };

beforeAll(async () => {
  ({ startServer } = await import('../index.ts'));
  server = startServer(0);
  // Give the listener a tick to bind.
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  await server.close();
});

/** A test client that records every server message and lets tests await one. */
class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve with the next message (past or future) matching `type`. */
  wait<T extends ServerMessage['type']>(type: T, timeoutMs = 3000): Promise<Extract<ServerMessage, { type: T }>> {
    const pred = (m: ServerMessage) => m.type === type;
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for '${type}'`)), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('server integration — happy path', () => {
  it('drives join -> selection -> declaration -> resolution for two clients', async () => {
    const p1 = new TestClient(server.port);
    const p2 = new TestClient(server.port);
    await Promise.all([p1.open(), p2.open()]);

    // 1) Join. First client waits alone, second triggers selectionStart.
    p1.send({ type: 'join' });
    const joined1 = await p1.wait('joined');
    expect(joined1.playerId).toBe(1);
    const sessionId = joined1.sessionId;
    await p1.wait('waiting');

    p2.send({ type: 'join' });
    const joined2 = await p2.wait('joined');
    expect(joined2.playerId).toBe(2);
    expect(joined2.sessionId).toBe(sessionId);

    // 2) Selection start broadcast to both.
    const sel1 = await p1.wait('selectionStart');
    const sel2 = await p2.wait('selectionStart');
    expect(sel1.species.length).toBeGreaterThan(0);
    expect(sel2.species.length).toBeGreaterThan(0);

    // Both pick species + 4 valid moves.
    p1.send({ type: 'selectPokemon', species: 'Pikachu' });
    p1.send({ type: 'selectMoves', moveIds: ['Thunderbolt', 'Quick Attack', 'Discharge', 'Volt Tackle'] });
    p2.send({ type: 'selectPokemon', species: 'Charizard' });
    p2.send({ type: 'selectMoves', moveIds: ['Flamethrower', 'Fire Fang', 'Air Slash', 'Dragon Claw'] });

    // 3) selectionDone + initial state + turnStart.
    await p1.wait('selectionDone');
    await p2.wait('selectionDone');
    const state1 = await p1.wait('state');
    expect(state1.battleState.pokemon.p1?.name).toBe('Pikachu');
    expect(state1.battleState.pokemon.p2?.name).toBe('Charizard');
    const ts1 = await p1.wait('turnStart');
    expect(ts1.turnNumber).toBe(1);
    await p2.wait('turnStart');

    // 4) Both declare a simple "stay put and attack" move (path = current tile only).
    const p1Tile = state1.battleState.pokemon.p1!.tile as [number, number];
    const p2Tile = state1.battleState.pokemon.p2!.tile as [number, number];
    p1.send({ type: 'declare', moveId: 'Thunderbolt', targetTile: p2Tile, movePath: [p1Tile], actionOrder: 'ATTACK_FIRST' });
    p2.send({ type: 'declare', moveId: 'Flamethrower', targetTile: p1Tile, movePath: [p2Tile], actionOrder: 'ATTACK_FIRST' });

    await p1.wait('declared');

    // 5) Resolution with non-empty log and a fresh state.
    const res = await p1.wait('resolution');
    expect(res.log.length).toBeGreaterThan(0);
    expect(res.newState).toBeTruthy();
    expect(res.newState.meta.sessionId).toBe(sessionId);
    expect(Array.isArray(res.resolvedActions)).toBe(true);

    // Overall ordering sanity for player 1's stream.
    const types = p1.messages.map((m) => m.type);
    expect(types.indexOf('joined')).toBeLessThan(types.indexOf('selectionStart'));
    expect(types.indexOf('selectionStart')).toBeLessThan(types.indexOf('selectionDone'));
    expect(types.indexOf('selectionDone')).toBeLessThan(types.indexOf('state'));
    expect(types.indexOf('state')).toBeLessThan(types.indexOf('resolution'));

    p1.close();
    p2.close();
  });

  it('responds to ping with pong', async () => {
    const c = new TestClient(server.port);
    await c.open();
    c.send({ type: 'join' });
    await c.wait('joined');
    c.send({ type: 'ping' });
    await c.wait('pong');
    c.close();
  });

  it('rejects an out-of-phase declare with an error', async () => {
    const c = new TestClient(server.port);
    await c.open();
    c.send({ type: 'join' });
    await c.wait('joined');
    // Declaring during selection/waiting is illegal.
    c.send({ type: 'declare', moveId: 'Thunderbolt', targetTile: null, movePath: [], actionOrder: 'ATTACK_FIRST' });
    const err = await c.wait('error');
    expect(err.message).toMatch(/phase/i);
    c.close();
  });
});
