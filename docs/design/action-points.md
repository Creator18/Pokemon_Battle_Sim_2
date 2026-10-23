# Action Points: rounds, budgets and simultaneous execution

Status: **proposal** (numbers to be tuned). Replaces the speed-ordered turn queue,
Attack First / Move First cooldowns, and "unused movement = charge".

## Rounds

Each round has two phases:

1. **Selection.** Both players plan in secret: a path, a charge amount, a move and a target tile, all paid for from one AP budget.
2. **Execution.** Both plans play out at the same time on a shared clock.

## The budget

| Rule | Value (proposed) |
|---|---|
| AP per round, every Pokémon | `AP_BUDGET = 100` |
| AP per tile moved | `round(2000 / speed)`, clamped 8–50, × the tile's terrain step cost |
| AP per charge level (+10% damage) | `round(speed / 5)`, clamped 6–30 |
| Charge cap | +80% (×1.8) |
| Momentum (physical) | ×(1 + 0.1 per straight tile toward the target), cap ×1.5 (as now) |

Faster Pokémon move cheaply and charge expensively; slower ones the reverse:

| Speed | AP per tile | Tiles on a full budget | AP per charge level | Charge on a full budget |
|---|---|---|---|---|
| 50 | 40 | 2 | 10 | capped at +80% |
| 80 | 25 | 4 | 16 | +60% |
| 100 | 20 | 5 | 20 | +50% |
| 130 | 15 | 6 | 26 | +30% |

Paralysis halves speed, so it changes both costs. Stat changes to speed change them too, from the moment they apply.

## What a plan can be

A plan is a sequence that fits in the budget. It takes one of two orders:

- **Move → (charge) → attack.**
  - Spend AP walking a path, then optionally spend AP charging, then the attack fires.
  - A special attack can be charged; you can't move after charging.
  - A physical attack uses momentum from the path instead.
- **Attack → move.**
  - The attack fires early, then the remaining AP is spent moving.
  - No charge and no momentum on that attack.

**Physical charge-and-launch.** This is an alternative to running for momentum, chosen per round for any physical move:

- The Pokémon charges in place and picks a direction.
- It dashes `charge levels` tiles that way (cap 6), striking whatever it meets.
- The player picks the direction but not the distance.
- The dash counts as a straight run for momentum, and charge cost follows the same speed rule.

**Status moves (Agility, Swords Dance…)** take the round's attack. The boost applies the moment the move is used, so the AP left after it is spent at the new speed.

## Special move rules

| Kind | Rule |
|---|---|
| Recharge moves (Hyper Beam, Giga Impact…) | next round's budget is `AP_BUDGET − 50` |
| Charge moves (Solar Beam, Sky Attack…) | must pay at least 40 AP of charge before firing; waived where the move's weather applies (Solar Beam in sun) |
| Priority moves (Quick Attack…) | their attack costs 0 AP of wind-up; every other attack costs `WINDUP = 10` AP |

## Stat stages

A stat stage lasts **at most 3 rounds**. Each stat has its own timer, reset whenever that stat changes again, and the stage returns to 0 when its timer runs out.

## Execution: the shared AP clock

AP spent is time. The clock runs from 0 to 100, and both plans advance on it together.

- **Movement.** At AP time *t*, each Pokémon is wherever its plan has walked it by *t*.
  - If both try to enter the same tile, the one that arrives earlier on the clock gets it.
  - If they arrive at the same moment, the faster Pokémon gets it, then the tie is random. The other stops where it is.
- **Attacks.** An attack fires at its AP time, aimed at the planned **target tile**.
  - It hits whoever is on, or in the line of, that tile **at that moment**.
  - If the target has already moved away, the attack misses. This is where prediction comes in.
- **Clashes.** Two attacks firing toward each other within a small window of the clock clash, as beams and rams do now.
- **Faint.** Execution stops at the moment a Pokémon faints.

## Removed

- The speed-ordered turn queue, and Attack First / Move First cooldowns.
- "Charge from unused movement range" (`chargesUp`).
- Early-stop boost.

Per-move cooldowns stay unless we decide otherwise.

## Open tuning questions

- The exact numbers above (budget, the speed divisors, caps, wind-up, recharge penalty).
- Whether charging shows up visually during execution (the aura growing) — proposed: yes.
