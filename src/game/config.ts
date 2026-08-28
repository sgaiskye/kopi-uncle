/**
 * **Every tunable number in the game lives here and nowhere else** (PRD §10.4).
 *
 * This is the one file a human opens to tune the difficulty curve (§13.1), and
 * the §8.5 values below have never been played — they are starting values. A
 * value change here is explicitly *not* a seam break: M0 freezes this file's
 * shape and keys, not its values, so tuning re-verifies neither track.
 *
 * **No agent story may tune these numbers.** Sprint 3 sets the shape; the final
 * pre-freeze play session sets the values.
 *
 * `tests/contract/config.test.ts` enforces the single-source rule mechanically:
 * the millisecond forms of §8.5's table and the wrong-serve penalty fraction
 * appear in no other file under `src/` or `tests/`.
 *
 * The table is not flat, so three pure selectors own the three formulas §8.5
 * states in prose — tea's mid-shift tier split, supper's per-customer patience
 * decay, and Endless holding gap and patience at their floors. Those formulas
 * live in `tierFor`, `gapMsFor` and `patienceMsFor` and nowhere else.
 */
import type { ShiftId, Tier } from './types';

export interface TierSplit {
  /** 1-based customer index from which `tier` applies for the rest of the shift. */
  readonly fromCustomer: number;
  readonly tier: Tier;
}

export interface ShiftConfig {
  readonly id: ShiftId;
  /** §8.5's customer count — N in `gap(i)`. */
  readonly customers: number;
  readonly tier: Tier;
  /** Tea splits tier mid-shift (§8.5, R17). `null` for shifts that do not. */
  readonly tierSplit: TierSplit | null;
  /** Patience for customer 1 of the shift. */
  readonly patienceMs: number;
  /** Supper steps patience down by this much per customer; 0 elsewhere. */
  readonly patienceDecayPerCustomerMs: number;
  /** The floor the decay lands on. Equal to `patienceMs` where there is no decay. */
  readonly patienceFloorMs: number;
  readonly gapStartMs: number;
  readonly gapEndMs: number;
}

export interface GameConfig {
  /** §8.7 — the spiral guard. */
  readonly QUEUE_CAP: number;
  /** §8.3 — game over at zero. */
  readonly HEARTS: number;
  /** R7, §13.3 — a wrong serve can never take patience below this. */
  readonly PATIENCE_FLOOR_MS: number;
  /** R7 — fraction of *maximum* patience a wrong serve costs. */
  readonly WRONG_SERVE_PENALTY_FRACTION: number;
  /** R5 — input lockout after a wrong serve. */
  readonly LOCKOUT_MS: number;
  /** §8.8 — combo is integer tenths, so the 0.1 step is 1. */
  readonly COMBO_STEP_TENTHS: number;
  readonly COMBO_MIN_TENTHS: number;
  readonly COMBO_MAX_TENTHS: number;
  /** §8.8 — `round(BASE_POINTS × comboTenths / 10)` per correct serve. */
  readonly BASE_POINTS: number;
  /** §8.8, R15 — awarded on entering the break with zero walkouts. */
  readonly SHIFT_CLEAR_BONUS: number;
  /** R20 — the engine's quantisation step. */
  readonly TICK_MS: number;
  /** R20 — the React layer clamps a single frame to this. */
  readonly MAX_FRAME_MS: number;
  readonly SHIFTS: readonly ShiftConfig[];
}

/**
 * Freezes the object graph, not just its root, so §10.3's `Object.freeze`
 * requirement holds for the shift table entries too. Asserted recursively by
 * `tests/contract/config.test.ts`.
 *
 * **No cycle guard, deliberately.** It is applied to exactly one value — the
 * object literal below, in the same statement that declares it — and an object
 * literal cannot reference itself, so the graph is a finite tree by
 * construction. A `WeakSet` would add a branch that no input can ever take,
 * which §10.7's 100%-branch rule would then be unable to cover. This function is
 * module-private and its only call site is the next statement; if a second call
 * site ever appears, or the literal grows a self-reference, the guard becomes
 * both necessary and coverable. The *test's* walk is cycle-safe because it is
 * written against `unknown`, where that guarantee does not hold.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

export const CONFIG: GameConfig = deepFreeze<GameConfig>({
  QUEUE_CAP: 3,
  HEARTS: 3,
  PATIENCE_FLOOR_MS: 2000,
  WRONG_SERVE_PENALTY_FRACTION: 0.35,
  LOCKOUT_MS: 600,
  COMBO_STEP_TENTHS: 1,
  COMBO_MIN_TENTHS: 10,
  COMBO_MAX_TENTHS: 30,
  BASE_POINTS: 100,
  SHIFT_CLEAR_BONUS: 500,
  TICK_MS: 16,
  MAX_FRAME_MS: 250,

  // §8.5. Difficulty ramps *within* a shift by tightening the arrival gap, then
  // resets to a floor one notch above the previous shift — a sawtooth, not a
  // monotonic climb.
  SHIFTS: [
    {
      id: 'breakfast',
      customers: 6,
      tier: 1,
      tierSplit: null,
      patienceMs: 18000,
      patienceDecayPerCustomerMs: 0,
      patienceFloorMs: 18000,
      gapStartMs: 6000,
      gapEndMs: 4000,
    },
    {
      id: 'lunch',
      customers: 8,
      tier: 2,
      tierSplit: null,
      patienceMs: 16000,
      patienceDecayPerCustomerMs: 0,
      patienceFloorMs: 16000,
      gapStartMs: 5000,
      gapEndMs: 3000,
    },
    {
      id: 'tea',
      customers: 10,
      tier: 2,
      // Tier 2 for customers 1–5, tier 3 from customer 6 (§8.5). R17: `siew dai`
      // and `kosong` stay unreachable at tier 1 by construction — not a bug.
      tierSplit: { fromCustomer: 6, tier: 3 },
      patienceMs: 14000,
      patienceDecayPerCustomerMs: 0,
      patienceFloorMs: 14000,
      gapStartMs: 4000,
      gapEndMs: 2500,
    },
    {
      id: 'supper',
      customers: 10,
      tier: 3,
      tierSplit: null,
      patienceMs: 12000,
      patienceDecayPerCustomerMs: 200,
      patienceFloorMs: 10000,
      gapStartMs: 3000,
      gapEndMs: 2000,
    },
  ],
});

/**
 * The shift the given index refers to. §10.3 pins `shiftIndex` at 3 in Endless,
 * so supper is the shift any index at or past the end of the table resolves to —
 * which is what makes §8.5's "supper repeats indefinitely" a clamp rather than a
 * special case.
 *
 * **Ruled here, per §13's never-ask instruction, on the same grounds as
 * `moodFor`'s `maxPatienceMs <= 0` band: `NaN` resolves to the first shift, and
 * to customer 1 in the selectors below.** An infinity is *ordered*, so the
 * existing clamps carry it to an end of the range and it needs no band of its
 * own. `NaN` is not ordered, and it survives both `Math.trunc` and a
 * `Math.min`/`Math.max` clamp: unguarded, the table lookup was `undefined` and
 * all three selectors threw a `TypeError`, while a `NaN` `customerIndex`
 * returned a `NaN` gap that would silently poison `nextArrivalMs` rather than
 * announcing itself. These selectors are on the frozen seam and callable by
 * track code that does not exist yet, so they are total for the same reason
 * `moodFor` is.
 */
function shiftAt(shiftIndex: number): ShiftConfig {
  const last = CONFIG.SHIFTS.length - 1;
  const index = Number.isNaN(shiftIndex) ? 0 : Math.trunc(shiftIndex);
  return CONFIG.SHIFTS[Math.min(Math.max(index, 0), last)];
}

/**
 * A finite, ordered customer index — see the ruling on `shiftAt`. Each selector
 * then applies its own `1…N` clamp, which this deliberately does not duplicate.
 *
 * `NaN` becomes 1. An infinity is *ordered*, so it is left to those clamps — with
 * one exception: the upper end is capped to a finite value, because
 * `patienceMsFor` multiplies the index by a decay that is `0` for three of the
 * four shifts, and `0 * Infinity` is `NaN`. The cap is far past any reachable
 * customer number, so no real index is affected.
 */
function customerAt(customerIndex: number): number {
  if (Number.isNaN(customerIndex)) return 1;
  return Math.min(customerIndex, Number.MAX_SAFE_INTEGER);
}

/** §8.6's tier budget for a given 1-based customer of a given shift. */
export function tierFor(shiftIndex: number, customerIndex: number): Tier {
  const shift = shiftAt(shiftIndex);
  const split = shift.tierSplit;
  if (split !== null && customerAt(customerIndex) >= split.fromCustomer) {
    return split.tier;
  }
  return shift.tier;
}

/**
 * §8.5's `gap(i) = start + (end − start) × (i − 1) / (N − 1)`, rounded to the
 * integer milliseconds R20 requires.
 *
 * `i` is clamped to `1…N`, so a customer past the shift's count — an Endless
 * supper repeat — holds the end value, which is §8.5's floor.
 */
export function gapMsFor(shiftIndex: number, customerIndex: number): number {
  const shift = shiftAt(shiftIndex);
  const i = Math.min(Math.max(customerAt(customerIndex), 1), shift.customers);
  return Math.round(
    shift.gapStartMs + ((shift.gapEndMs - shift.gapStartMs) * (i - 1)) / (shift.customers - 1),
  );
}

/**
 * §8.5's patience: constant within a shift, except at supper where it steps down
 * per customer to its floor.
 *
 * `i` is deliberately *not* clamped to N here — supper's decay continues past
 * the shift's count until the floor catches it, which is how an Endless repeat
 * arrives at the floor and stays there. The floor is `max`'d in, so the result
 * never drops below §8.5's stated minimum.
 */
export function patienceMsFor(shiftIndex: number, customerIndex: number): number {
  const shift = shiftAt(shiftIndex);
  const i = Math.max(customerAt(customerIndex), 1);
  return Math.max(
    shift.patienceMs - shift.patienceDecayPerCustomerMs * (i - 1),
    shift.patienceFloorMs,
  );
}
