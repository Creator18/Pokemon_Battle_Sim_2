# The Hunger Games: rules for tributes

Ten tributes, one Pokémon each, fight elimination series in the boss arena (a flat stadium floor, about x −11 … +11, side-on).
Lose a series and you are out. Survivors get their match logs and may rewrite their brain between rounds. Last one standing wins.

## Your deliverable

One file: `docs/hunger/brains/<your-slug>.js`. It must register itself like this (plain browser JavaScript, no imports):

```js
window.__brains = window.__brains || {};
window.__brains['d1-charizard'] = {
  name: 'Your tribute name',
  species: 'Charizard',                 // your assigned species; don't change it
  kit: { ranged: 'Flamethrower', close: 'Flare Blitz', mobility: 'Quick Attack', control: 'Detect' },
  strategy: 'One or two sentences: how you mean to win.',
  make({ me, foe, arena, BossAI, Fighter, consts, memory, clock }) {
    // Called once at the start of every battle. Return a function the game calls EVERY FRAME (about 60 a second):
    // it gets the battle clock (seconds) and returns an Intent.
    return (t) => ({ want: 0, aim: 0, jumpHeld: false, jumpPressed: false, sink: false,
                     ranged: false, close: false, mobility: false, control: false, dash: false });
  },
};
```

- `me`, `foe`: the two `Fighter`s (src/client/platformer/Fighter.ts). **Read-only**: read anything, change nothing.
- `arena`: `{ level, fighters, pillars }`.
- `BossAI`: the stock bot (src/client/platformer/BossAI.ts). You may wrap it: `const base = new BossAI(me, foe, style); base.arena = arena;` then call `base.think()` and edit its Intent, or ignore it entirely and write your own.
- `consts`: `AIM_ANGLE, AIM_MIN, AIM_RATE, AIM_HOLD_MAX, CLOSE_REACH, RAM_DIST, QUICK_DIST, BEAM_REACH, BALL_REACH, BRACES, IDLE, isBall, isRamMove, isQuickStrike, isFlurry, beamFor, getMove`.
- `memory`: an object that persists across all your battles (within one session). Use it to learn about your opponents.
- A brain that throws is replaced by IDLE for that frame (errors are logged and shown to you). A brain whose `make` throws is replaced by the stock bot.

### The Intent (what your bot "presses" this frame)

| field | meaning |
|---|---|
| `want` | −1 run left, +1 run right, 0 stand |
| `face` | optional: −1 / +1 to turn without running |
| `aim` | −1 … +1: aim down … up (× `AIM_ANGLE` radians). See ranged aiming below |
| `jumpPressed` / `jumpHeld` | jump (press); held = fly up for fliers, glide when let go |
| `sink` | fliers: sink down |
| `ranged`, `close`, `mobility`, `control` | a press of that move's key this frame (U, I, J, K) |
| `rangedHeld` | optional. Set it (true while held, false to let go) to aim like the player: the line swings by `aim` × `AIM_RATE` a second. Leave it **undefined** to aim like a bot: the line swings to `aim` and fires once it gets there |
| `dash` | the dash every Pokémon has (L): toward `want`, or a back dash with `want` 0 |

Presses are edge-triggered by you: setting `ranged: true` every frame does not queue extra shots, but a move only starts if your Pokémon isn't busy and the move is off cooldown (`me.ready(move)`).

## Your kit

One move per slot, chosen from the lists below. Attacking moves must be **one of your Pokémon's types, or Normal**. A Counter or Sucker Punch control counts as your mobility move (you then get no mobility move). Moves not on these lists can't be played and will be replaced by a safe move.

- **ranged** (beams and balls; Stone Edge too): Ember, Fire Blast, Flamethrower, Mystical Fire, Thunderbolt, Charge Beam, Electro Shot, Shadow Ball, Moongeist Beam, Aeroblast, Moonblast, Fleur Cannon, Light of Ruin, Aura Sphere, Focus Blast, Dragon Pulse, Dragon Rage, Roar of Time, Core Enforcer, Eternabeam, Dragon Energy, Nihil Light, Hyper Beam, Tri Attack, Photon Geyser, Psybeam, Ice Beam, Aurora Beam, Solar Beam, Flash Cannon, Steel Beam, Signal Beam, Hydro Pump, Hydro Cannon, Meteor Beam, Stone Edge
- **close**
  - rams (a charge across the floor, momentum adds damage, recoil on some): Volt Tackle, Wild Charge, Flare Blitz, Take Down, Double-Edge, Giga Impact, Head Smash, Iron Head, Wood Hammer, Brave Bird, Acrobatics, Sky Attack, Wave Crash, Dragon Rush
  - flurries (a burst of blows where it stands; whole damage at once): Iron Tail, Close Combat, Fire Fang, Thrash, Outrage, Play Rough, Ice Fang, Crunch, Sand Tomb
  - slashes (one crescent cut): Scratch, Cut, Slash, Night Slash, Psycho Cut, Psyblade, Dragon Claw, X-Scissor, Shadow Claw, Leaf Blade, Cross Poison, Sacred Sword, Metal Claw, Bitter Blade, Aqua Cutter
  - Earthquake (three tremors round you; jump them)
- **mobility**: priority dashes (Quick Attack, Extreme Speed, Bullet Punch, Mach Punch, Aqua Jet, Jet Punch, Ice Shard, Accelerock, Zippy Zap, Grassy Glide, First Impression, Upper Hand), strikes from behind (Shadow Sneak, Feint), Teleport, Agility
- **control**: Detect, Counter, Sucker Punch, Growl (lowers the foe's Attack), Smokescreen (lowers the foe's accuracy, i.e. its moves travel slower)

Move data (power, type, recoil): `src/shared/data/raw/*.json`. Species base stats: `src/shared/data/raw/pokemon.json`.

## How fights work (the rules that matter)

- HP is 10× the main series; stats are level 100, perfect IVs. Damage is the main-series formula with STAB and type effectiveness.
- **Ranged moves must be aimed**: on a press the line appears level, swings toward your aim, and fires on release — never sooner than `AIM_MIN` (0.25 s). While aiming you are rooted (you may turn). Hit while aiming: the aim is lost.
- **No invulnerability after a hit**: you can be hit again straight away. Every attack's cooldown is 1.6× longer to make up for it. A struck Pokémon flinches (can't act) for its hit reaction.
- **Contact moves push through ranged fire**: a ram, flurry, slash, priority dash or strike from behind hit by a ranged move keeps going, taking the damage. But if a contact move reaches a ranged attacker first, that attacker flinches and its attack is lost.
- **Flurries** deal their whole damage on the first blow that connects; a caught foe is held for every blow.
- Beams that meet clash; the stronger (power and type) wins. Balls can be met too.
- **Accuracy** = how fast a move travels (Fire Blast 85% flies at 85% speed); Smokescreen lowers the foe's. **Speed** stat sets cooldowns. Evasion stages change run speed. Stages last 20 s.
- **Flight is limited** (new): a flier may stay up for at most 5 s at a time (`me.flightLeft`, `FLY_TIME`), still no higher than the height cap. Then it drops out of the sky and can't take off again until 3 s after it lands.
- Braces: Detect blocks; Counter / Sucker Punch turn a blow back (physical only for Counter).
- Physical attacks gain damage from a straight run-up (momentum), except priority moves.
- **Series**: best of 3, sides swapped each battle, 150 s limit. A timeout goes to the higher HP share; a dead-even draw is replayed.

## Fair play

- Only write your own brain file. Don't edit anything under `src/` or anyone else's files.
- Don't use the browser (the organiser runs every match) and don't run the dev server.
- **No hover stalling.** Flying high out of the foe's reach to run down the clock is banned. The organiser enforces it: a Pokémon that stays more than 2.5 body heights above the floor for over 4 s in a row is made to sink back down to the ground.
- Your brain only *reads* the game and *returns intents*. Changing any game object (HP, positions, cooldowns, the foe's moves, `window` globals other than your own `window.__brains[slug]`) is cheating and gets you disqualified.
