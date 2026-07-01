import { PokemonState } from '../core/PokemonState';
import { MoveRegistry } from '../core/MoveDefinition';
import { SPECIES } from '../data/SpeciesData';
import { PokemonType } from '../core/Enums';

const THEME = {
  bg: '#0D0D1A',
  bgPanel: '#12122A',
  bgPanelLight: '#1a1a35',
  accent: '#EF4444',
  text: '#E8E8F0',
  textMuted: '#9090B0',
  border: '#2a2a4a',
  p1Color: '#60A5FA',
  p2Color: '#F87171',
};

const TYPE_COLORS: Record<number, string> = {
  [PokemonType.Normal]: '#A8A878',
  [PokemonType.Fire]: '#F08030',
  [PokemonType.Water]: '#6890F0',
  [PokemonType.Electric]: '#F8D030',
  [PokemonType.Grass]: '#78C850',
  [PokemonType.Ice]: '#98D8D8',
  [PokemonType.Fighting]: '#C03028',
  [PokemonType.Poison]: '#A040A0',
  [PokemonType.Ground]: '#E0C068',
  [PokemonType.Flying]: '#A890F0',
  [PokemonType.Psychic]: '#F85888',
  [PokemonType.Bug]: '#A8B820',
  [PokemonType.Rock]: '#B8A038',
  [PokemonType.Ghost]: '#705898',
  [PokemonType.Dragon]: '#7038F8',
  [PokemonType.Dark]: '#705848',
  [PokemonType.Steel]: '#B8B8D0',
  [PokemonType.Fairy]: '#EE99AC',
};

export interface SpeciesSelectedCallback {
  (p1Id: string, p2Id: string): void;
}

export interface MoveSelectedCallback {
  (moveId: string): void;
}

export class BattleUI {
  private root: HTMLElement;

  // Panels
  private p1Panel!: HTMLElement;
  private p2Panel!: HTMLElement;
  private turnBanner!: HTMLElement;
  private movePanel!: HTMLElement;
  private logPanel!: HTMLElement;
  private gameOverOverlay!: HTMLElement;
  private selectionScreen!: HTMLElement;
  private tooltipEl!: HTMLElement;
  private currentPlayerLabel!: HTMLElement;

  private logLines: string[] = [];

  onSpeciesSelected: SpeciesSelectedCallback | null = null;
  onMoveSelected: MoveSelectedCallback | null = null;

  constructor(rootId: string) {
    this.root = document.getElementById(rootId)!;
    this._buildLayout();
  }

  private _buildLayout(): void {
    this.root.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 10;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: ${THEME.text};
    `;

    // P1 HP Panel (top-left)
    this.p1Panel = this._mkEl('div', `
      position: absolute; top: 16px; left: 16px;
      width: 240px; background: ${THEME.bgPanel};
      border: 1px solid ${THEME.border}; border-radius: 10px;
      padding: 12px 16px; pointer-events: none;
    `);
    this.root.appendChild(this.p1Panel);

    // P2 HP Panel (top-right)
    this.p2Panel = this._mkEl('div', `
      position: absolute; top: 16px; right: 16px;
      width: 240px; background: ${THEME.bgPanel};
      border: 1px solid ${THEME.border}; border-radius: 10px;
      padding: 12px 16px; pointer-events: none; text-align: right;
    `);
    this.root.appendChild(this.p2Panel);

    // Turn banner (top-center)
    this.turnBanner = this._mkEl('div', `
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      background: ${THEME.bgPanel}; border: 1px solid ${THEME.border};
      border-radius: 8px; padding: 8px 24px;
      font-size: 14px; font-weight: 600; text-align: center;
      pointer-events: none; min-width: 180px;
    `);
    this.root.appendChild(this.turnBanner);

    // Current player label
    this.currentPlayerLabel = this._mkEl('div', `
      position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
      font-size: 13px; color: ${THEME.textMuted}; pointer-events: none; text-align: center;
    `);
    this.root.appendChild(this.currentPlayerLabel);

    // Move selection panel (bottom-center)
    this.movePanel = this._mkEl('div', `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      background: ${THEME.bgPanel}; border: 1px solid ${THEME.border};
      border-radius: 10px; padding: 12px 16px; display: flex; gap: 8px;
      pointer-events: auto; min-width: 480px; align-items: center; flex-wrap: wrap;
      justify-content: center;
    `);
    this.root.appendChild(this.movePanel);

    // Battle log (bottom-right)
    this.logPanel = this._mkEl('div', `
      position: absolute; bottom: 16px; right: 16px;
      width: 280px; max-height: 220px; overflow-y: auto;
      background: ${THEME.bgPanel}; border: 1px solid ${THEME.border};
      border-radius: 10px; padding: 10px 12px;
      font-size: 12px; color: ${THEME.textMuted}; pointer-events: auto;
      line-height: 1.6;
    `);
    this.root.appendChild(this.logPanel);

    // Tooltip
    this.tooltipEl = this._mkEl('div', `
      position: absolute; display: none;
      background: ${THEME.bgPanelLight}; border: 1px solid ${THEME.border};
      border-radius: 6px; padding: 6px 10px;
      font-size: 12px; color: ${THEME.text}; pointer-events: none;
      white-space: pre-line; z-index: 20;
    `);
    this.root.appendChild(this.tooltipEl);

    // Game over overlay (hidden)
    this.gameOverOverlay = this._mkEl('div', `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(13,13,26,0.88); display: none;
      align-items: center; justify-content: center; flex-direction: column;
      pointer-events: auto; z-index: 50;
    `);
    this.root.appendChild(this.gameOverOverlay);

    // Species selection screen
    this._buildSelectionScreen();
  }

  private _buildSelectionScreen(): void {
    this.selectionScreen = this._mkEl('div', `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: ${THEME.bg}; display: flex; align-items: center;
      justify-content: center; flex-direction: column; gap: 32px;
      pointer-events: auto; z-index: 100;
    `);

    const title = this._mkEl('h1', `
      font-size: 28px; font-weight: 800; letter-spacing: 2px;
      color: ${THEME.text}; text-shadow: 0 0 20px #EF4444aa;
      margin: 0;
    `);
    title.textContent = 'POKEMON HEX BATTLE';
    this.selectionScreen.appendChild(title);

    const subtitle = this._mkEl('p', `color: ${THEME.textMuted}; font-size: 14px; margin: 0;`);
    subtitle.textContent = 'Select your Pokemon for each player';
    this.selectionScreen.appendChild(subtitle);

    const row = this._mkEl('div', `display: flex; gap: 48px; align-items: flex-start;`);

    let p1Id = SPECIES[0].id;
    let p2Id = SPECIES[1].id;

    const p1Col = this._buildPlayerPick('Player 1', THEME.p1Color, (id) => { p1Id = id; });
    const p2Col = this._buildPlayerPick('Player 2', THEME.p2Color, (id) => { p2Id = id; });
    row.appendChild(p1Col);
    row.appendChild(p2Col);
    this.selectionScreen.appendChild(row);

    const startBtn = this._mkEl('button', `
      background: ${THEME.accent}; color: white; border: none;
      padding: 14px 48px; font-size: 16px; font-weight: 700;
      border-radius: 8px; cursor: pointer; letter-spacing: 1px;
      transition: opacity 0.15s; pointer-events: auto;
    `);
    startBtn.textContent = 'START BATTLE';
    startBtn.onmouseenter = () => (startBtn.style.opacity = '0.85');
    startBtn.onmouseleave = () => (startBtn.style.opacity = '1');
    startBtn.onclick = () => {
      this.hideSelectionScreen();
      this.onSpeciesSelected?.(p1Id, p2Id);
    };
    this.selectionScreen.appendChild(startBtn);

    const hint = this._mkEl('p', `color: ${THEME.textMuted}; font-size: 12px; margin: 0; text-align: center;`);
    hint.textContent = 'Q/E to rotate camera  •  Scroll to zoom  •  Right-drag to orbit';
    this.selectionScreen.appendChild(hint);

    this.root.appendChild(this.selectionScreen);
  }

  private _buildPlayerPick(label: string, color: string, onChange: (id: string) => void): HTMLElement {
    const col = this._mkEl('div', `
      display: flex; flex-direction: column; gap: 12px; align-items: center;
    `);

    const lbl = this._mkEl('div', `
      font-size: 13px; font-weight: 700; color: ${color}; letter-spacing: 1px;
      text-transform: uppercase;
    `);
    lbl.textContent = label;
    col.appendChild(lbl);

    for (const species of SPECIES) {
      const btn = this._mkEl('button', `
        width: 180px; padding: 10px 16px;
        background: ${THEME.bgPanel}; border: 2px solid ${THEME.border};
        border-radius: 8px; cursor: pointer; text-align: left;
        color: ${THEME.text}; font-size: 14px; font-weight: 600;
        pointer-events: auto; transition: border-color 0.15s, background 0.15s;
      `);

      const typeRow = this._mkEl('div', `display: flex; gap: 4px; margin-top: 4px;`);
      for (const t of species.types) {
        const chip = this._mkEl('span', `
          font-size: 10px; padding: 2px 6px; border-radius: 4px;
          background: ${TYPE_COLORS[t] ?? '#666'}; color: white; font-weight: 700;
        `);
        chip.textContent = PokemonType[t].toUpperCase();
        typeRow.appendChild(chip);
      }

      btn.textContent = species.name;
      btn.appendChild(typeRow);

      btn.onclick = () => {
        // Deselect all
        col.querySelectorAll('button').forEach(b => {
          (b as HTMLElement).style.borderColor = THEME.border;
          (b as HTMLElement).style.background = THEME.bgPanel;
        });
        btn.style.borderColor = color;
        btn.style.background = THEME.bgPanelLight;
        onChange(species.id);
      };

      // Select first by default
      if (species === SPECIES[label.includes('1') ? 0 : 1]) {
        btn.style.borderColor = color;
        btn.style.background = THEME.bgPanelLight;
      }

      col.appendChild(btn);
    }
    return col;
  }

  showSelectionScreen(): void {
    this.selectionScreen.style.display = 'flex';
  }

  hideSelectionScreen(): void {
    this.selectionScreen.style.display = 'none';
  }

  updateHP(p: PokemonState): void {
    const panel = p.playerId === 1 ? this.p1Panel : this.p2Panel;
    const color = p.playerId === 1 ? THEME.p1Color : THEME.p2Color;
    const pct = p.currentHp / p.maxHp;
    const barColor = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : THEME.accent;

    const typeChips = p.types.map(t =>
      `<span style="font-size:10px;padding:2px 5px;border-radius:3px;background:${TYPE_COLORS[t] ?? '#666'};color:white;font-weight:700;">${PokemonType[t].toUpperCase()}</span>`
    ).join(' ');

    const statusIcons = [...p.status].filter(s => s !== 0).map(s => {
      const labels: Record<number, string> = { 1: 'TAU', 2: 'FLI', 3: 'SLP', 4: 'PAR', 5: 'BRN' };
      return `<span style="font-size:10px;padding:2px 5px;border-radius:3px;background:#444;color:#fff;">${labels[s] ?? '?'}</span>`;
    }).join(' ');

    panel.innerHTML = `
      <div style="font-size:15px;font-weight:700;color:${color};margin-bottom:4px;">
        ${p.name} ${typeChips}
      </div>
      <div style="font-size:12px;color:${THEME.textMuted};margin-bottom:6px;">
        HP: ${p.currentHp} / ${p.maxHp} ${statusIcons}
      </div>
      <div style="width:100%;height:8px;background:#222;border-radius:4px;overflow:hidden;">
        <div style="width:${Math.max(0, pct * 100).toFixed(1)}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.3s;"></div>
      </div>
      <div style="font-size:11px;color:${THEME.textMuted};margin-top:4px;">
        Tile: (${p.tile.x},${p.tile.y}) | Spd: ${p.speed}
      </div>
    `;
  }

  updateTurnBanner(turnNumber: number, phase: string): void {
    this.turnBanner.innerHTML = `
      <div style="color:${THEME.textMuted};font-size:11px;letter-spacing:1px;text-transform:uppercase;">Turn</div>
      <div style="font-size:20px;font-weight:800;color:${THEME.text};">${turnNumber}</div>
      <div style="font-size:11px;color:${THEME.textMuted};">${phase}</div>
    `;
  }

  setCurrentPlayerLabel(text: string, color: string): void {
    this.currentPlayerLabel.innerHTML = `<span style="color:${color};font-weight:600;">${text}</span>`;
  }

  showMovePanel(actor: PokemonState, currentPlayerId: number): void {
    this.movePanel.innerHTML = '';
    const color = currentPlayerId === 1 ? THEME.p1Color : THEME.p2Color;

    const label = this._mkEl('div', `
      font-size: 12px; font-weight: 700; color: ${color}; width: 100%; text-align: center;
      margin-bottom: 4px;
    `);
    label.textContent = `Player ${currentPlayerId} — Choose a move:`;
    this.movePanel.appendChild(label);

    const row = this._mkEl('div', `display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;`);

    for (const moveId of actor.movePool) {
      const move = MoveRegistry.get(moveId);
      if (!move) continue;

      const onCooldown = (actor.cooldowns.get(moveId) ?? 0) > 0;

      const btn = this._mkEl('button', `
        padding: 10px 14px; background: ${onCooldown ? '#1a1a2a' : THEME.bgPanelLight};
        border: 2px solid ${onCooldown ? '#333' : TYPE_COLORS[move.type] ?? THEME.border};
        border-radius: 8px; cursor: ${onCooldown ? 'not-allowed' : 'pointer'};
        color: ${onCooldown ? THEME.textMuted : THEME.text};
        font-size: 13px; font-weight: 600; min-width: 110px; text-align: left;
        pointer-events: auto; transition: background 0.15s;
        opacity: ${onCooldown ? '0.5' : '1'};
      `);

      const typeColor = TYPE_COLORS[move.type] ?? '#666';
      btn.innerHTML = `
        <div style="font-size:13px;font-weight:700;">${move.name}</div>
        <div style="font-size:10px;margin-top:2px;">
          <span style="color:${typeColor};">${PokemonType[move.type]}</span>
          ${move.basePower > 0 ? `<span style="color:${THEME.textMuted};"> · ${move.basePower} pw</span>` : `<span style="color:${THEME.textMuted};"> · Status</span>`}
          ${move.quickPriority ? `<span style="color:#facc15;"> ⚡</span>` : ''}
        </div>
        ${onCooldown ? `<div style="font-size:10px;color:${THEME.accent};">CD: ${actor.cooldowns.get(moveId)}</div>` : ''}
      `;

      if (!onCooldown) {
        btn.onclick = () => {
          this.onMoveSelected?.(moveId);
        };
        btn.onmouseenter = () => { btn.style.background = '#22224a'; };
        btn.onmouseleave = () => { btn.style.background = THEME.bgPanelLight; };
      }

      row.appendChild(btn);
    }
    this.movePanel.appendChild(row);
  }

  hideMovePanel(): void {
    this.movePanel.innerHTML = `
      <div style="color:${THEME.textMuted};font-size:13px;text-align:center;padding:8px;">
        Click a tile on the board to confirm target, then finalize.
      </div>
    `;
  }

  showWaitingPanel(waitingForPlayer: number): void {
    const color = waitingForPlayer === 1 ? THEME.p1Color : THEME.p2Color;
    this.movePanel.innerHTML = `
      <div style="color:${color};font-size:14px;font-weight:600;padding:8px 16px;">
        Waiting for Player ${waitingForPlayer} to choose a move...
      </div>
    `;
  }

  addLog(lines: string[]): void {
    for (const line of lines) {
      this.logLines.push(line);
    }
    if (this.logLines.length > 40) {
      this.logLines = this.logLines.slice(-40);
    }
    this._renderLog();
  }

  private _renderLog(): void {
    const recent = this.logLines.slice(-20);
    this.logPanel.innerHTML = recent.map((line, i) => {
      const alpha = 0.4 + (i / recent.length) * 0.6;
      return `<div style="opacity:${alpha.toFixed(2)};margin-bottom:2px;">${line}</div>`;
    }).join('');
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
  }

  showGameOver(winnerText: string): void {
    this.gameOverOverlay.style.display = 'flex';
    this.gameOverOverlay.innerHTML = `
      <div style="
        background: ${THEME.bgPanel}; border: 2px solid ${THEME.accent};
        border-radius: 16px; padding: 40px 64px; text-align: center;
        max-width: 400px;
      ">
        <div style="font-size:36px;font-weight:800;color:${THEME.accent};margin-bottom:8px;">BATTLE OVER</div>
        <div style="font-size:22px;font-weight:700;color:${THEME.text};margin-bottom:24px;">${winnerText}</div>
        <button id="restartBtn" style="
          background: ${THEME.accent}; color: white; border: none;
          padding: 12px 36px; font-size: 16px; font-weight: 700;
          border-radius: 8px; cursor: pointer; pointer-events: auto;
        ">Play Again</button>
      </div>
    `;
    const btn = document.getElementById('restartBtn');
    if (btn) btn.onclick = () => location.reload();
  }

  showTooltip(text: string, x: number, y: number): void {
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = 'block';
    this.tooltipEl.style.left = `${x + 12}px`;
    this.tooltipEl.style.top = `${y - 12}px`;
  }

  hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private _mkEl(tag: string, css: string): HTMLElement {
    const el = document.createElement(tag);
    el.style.cssText = css;
    return el;
  }
}
