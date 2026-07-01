/**
 * GameController — owns the screen/state flow:
 *   Connect → Draft → Battle(declare ↔ resolution) → GameOver.
 * Translates ServerMessages into UI/scene updates and UI actions into
 * ClientMessages. Maintains a local BattleSession mirror synced from
 * `state` / `resolution.newState` for legality previews.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import {
  BattleSession,
  getSpecies,
  type BattleStateJSON,
  type SpeciesDefinition,
  type ResolutionMsg,
} from '../shared/index.ts';

import { NetClient } from './net/NetClient.ts';
import { HexBoard } from './render/HexBoard.ts';
import { PokemonFactory } from './render/PokemonFactory.ts';
import { MoveVfx } from './vfx/MoveVfx.ts';
import { BattleCamera } from './camera/BattleCamera.ts';

import { ConnectScreen } from './ui/ConnectScreen.ts';
import { DraftScreen } from './ui/DraftScreen.ts';
import { HUD } from './ui/HUD.ts';
import { BattleLog } from './ui/BattleLog.ts';
import { DeclarationPanel, type HighlightSetter } from './ui/DeclarationPanel.ts';
import { GameOverOverlay } from './ui/GameOverOverlay.ts';
import { ResolutionPlayback } from './ui/ResolutionPlayback.ts';

export interface GameControllerDeps {
  net: NetClient;
  board: HexBoard;
  factory: PokemonFactory;
  vfx: MoveVfx;
  camera: BattleCamera;
  uiRoot: HTMLElement;
}

export class GameController {
  private net: NetClient;
  private board: HexBoard;
  private factory: PokemonFactory;
  private camera: BattleCamera;
  private playback: ResolutionPlayback;

  private connectScreen: ConnectScreen;
  private draftScreen: DraftScreen;
  private hud: HUD;
  private battleLog: BattleLog;
  private declPanel: DeclarationPanel;
  private gameOver: GameOverOverlay;

  private localPlayerId = 1;
  private sessionId = '';
  private mirror: BattleSession | null = null;
  private units = new Map<number, TransformNode>();
  private lastState: BattleStateJSON | null = null;
  private species: SpeciesDefinition[] = [];
  private busy = false; // during playback

  constructor(deps: GameControllerDeps) {
    this.net = deps.net;
    this.board = deps.board;
    this.factory = deps.factory;
    this.camera = deps.camera;
    this.playback = new ResolutionPlayback(deps.board, deps.factory, deps.vfx, deps.camera);

    this.connectScreen = new ConnectScreen({ onJoin: (sid) => this.doJoin(sid) });
    this.draftScreen = new DraftScreen({
      onSelectSpecies: (s) => this.net.selectPokemon(s),
      onSelectMoves: (m) => this.net.selectMoves(m),
    });
    this.hud = new HUD(this.localPlayerId);
    this.battleLog = new BattleLog();
    this.declPanel = new DeclarationPanel({
      onDeclare: (moveId, target, path, order) => this.net.declare(moveId, target, path, order),
      setHighlights: (fn) => this.applyHighlights(fn),
      clearHighlights: () => this.board.clearHighlights(),
    });
    this.gameOver = new GameOverOverlay(() => window.location.reload());

    for (const c of [this.connectScreen, this.draftScreen, this.hud, this.battleLog, this.declPanel, this.gameOver]) {
      deps.uiRoot.append(c.root);
    }

    this.board.onTilePicked((tile) => {
      if (!this.busy) this.declPanel.handleTilePick(tile);
    });

    // Debug/testing affordance: allow programmatic tile picks (e.g. E2E checks).
    (window as unknown as { __pbwPickTile?: (q: number, r: number) => void }).__pbwPickTile = (q, r) => {
      if (!this.busy) this.declPanel.handleTilePick([q, r]);
    };

    this.wireNet();
  }

  start(): void {
    this.connectScreen.show();
    this.net.onStatus((s) => this.connectScreen.setStatus(s));
    void this.net.connect();
  }

  private doJoin(sessionId: string | undefined): void {
    this.net
      .connect()
      .then(() => this.net.join(sessionId))
      .catch(() => this.connectScreen.setStatus('error'));
  }

  private applyHighlights(fn: (setter: HighlightSetter) => void): void {
    const setter: HighlightSetter = (keys, type) => {
      const arr = Array.isArray(keys) ? keys : [...(keys as Iterable<string>)];
      this.board.highlightTiles(arr, type);
    };
    fn(setter);
  }

  // ── Server message wiring ─────────────────
  private wireNet(): void {
    this.net.on('joined', (m) => {
      this.localPlayerId = m.playerId;
      this.sessionId = m.sessionId;
      this.hud.setLocalPlayer(m.playerId);
      this.declPanel.setLocalPlayer(m.playerId);
    });

    this.net.on('waiting', () => {
      this.connectScreen.showWaiting(this.sessionId);
    });

    this.net.on('selectionStart', (m) => {
      this.species = m.species;
      this.connectScreen.hide();
      this.draftScreen.setSpecies(m.species);
      this.draftScreen.show();
    });

    this.net.on('selectionUpdate', (m) => {
      if (m.playerId !== this.localPlayerId) this.draftScreen.setOpponentReady();
    });

    this.net.on('selectionDone', () => {
      this.draftScreen.hide();
    });

    this.net.on('state', (m) => {
      void this.onState(m.battleState);
    });

    this.net.on('turnStart', () => {
      // Declaration re-enabled once state is synced (handled in onState / after resolution).
    });

    this.net.on('declared', (m) => {
      if (m.playerId !== this.localPlayerId) {
        // opponent declared; local panel already shows waiting if we declared.
      }
    });

    this.net.on('resolution', (m) => {
      void this.onResolution(m);
    });

    this.net.on('gameOver', (m) => {
      this.declPanel.hide();
      this.board.clearHighlights();
      this.gameOver.show(m.winner, this.localPlayerId);
    });

    this.net.on('error', (m) => {
      console.warn('[server error]', m.message);
    });
  }

  private async onState(state: BattleStateJSON): Promise<void> {
    const firstBattle = this.mirror === null;
    this.mirror = BattleSession.fromJSON(state);
    this.lastState = state;

    this.connectScreen.hide();
    this.draftScreen.hide();

    await this.ensureUnits(state);
    this.board.syncTerrain(state);
    this.hud.update(state);
    this.hud.show();
    this.battleLog.show();
    this.positionUnits(state);

    if (firstBattle) {
      this.battleLog.append(state.battleLog);
      this.camera.focusOn(this.localSpawn(state));
    }

    // Begin declaration for this turn.
    if (!state.meta.battleOver) {
      this.declPanel.beginTurn(this.mirror);
    }
  }

  private localSpawn(state: BattleStateJSON): [number, number] {
    const p = this.localPlayerId === 1 ? state.pokemon.p1 : state.pokemon.p2;
    return p ? [p.tile[0], p.tile[1]] : [0, 0];
  }

  private async ensureUnits(state: BattleStateJSON): Promise<void> {
    for (const pid of [1, 2] as const) {
      if (this.units.has(pid)) continue;
      const p = pid === 1 ? state.pokemon.p1 : state.pokemon.p2;
      if (!p) continue;
      const species = getSpecies(p.name) ?? this.species.find((s) => s.name === p.name);
      if (!species) continue;
      const node = await this.factory.createPokemon(species, pid);
      this.units.set(pid, node);
    }
  }

  private positionUnits(state: BattleStateJSON): void {
    for (const pid of [1, 2] as const) {
      const p = pid === 1 ? state.pokemon.p1 : state.pokemon.p2;
      const node = this.units.get(pid);
      if (!p || !node) continue;
      const pos = this.board.tileTop(p.tile[0], p.tile[1]);
      node.position = new Vector3(pos.x, node.position.y || 0, pos.z);
      if (p.status === 'fainted') node.setEnabled(false);
      else if (!node.isEnabled()) this.factory.revive(node);
      // Face toward center / opponent.
      const other = pid === 1 ? state.pokemon.p2 : state.pokemon.p1;
      if (other) {
        const o = this.board.tileTop(other.tile[0], other.tile[1]);
        this.factory.setFacing(node, Math.atan2(o.x - pos.x, o.z - pos.z));
      }
    }
  }

  private async onResolution(m: ResolutionMsg): Promise<void> {
    this.busy = true;
    this.declPanel.lockForResolution();
    this.board.clearHighlights();
    this.battleLog.append(m.log.length ? m.log : ['(no events)']);

    const prev = this.lastState ?? m.newState;
    try {
      // Cap playback so a stalled animation (e.g. throttled render loop in a
      // backgrounded tab) can never block the turn from advancing.
      const cap = 8000 + m.resolvedActions.length * 2000;
      await Promise.race([
        this.playback.play(m, this.units, prev),
        new Promise<void>((r) => setTimeout(r, cap)),
      ]);
    } catch (err) {
      console.warn('[playback] error', err);
    } finally {
      // Apply authoritative new state regardless of playback outcome.
      this.mirror = BattleSession.fromJSON(m.newState);
      this.lastState = m.newState;
      this.board.syncTerrain(m.newState);
      this.positionUnits(m.newState);
      this.hud.update(m.newState);
      this.busy = false;

      if (!m.newState.meta.battleOver) {
        this.declPanel.beginTurn(this.mirror);
      }
    }
  }
}
