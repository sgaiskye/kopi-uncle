/**
 * S9-1 — the §10.5 fixture catalogue: hand-written, hand-checked `GameState`
 * snapshots that Track B renders against while `src/game/engine.ts` is still
 * three throwing signatures.
 *
 * §10.5 is explicit that a stub which merely typechecks unblocks nothing.
 * Patience rings, mood faces, break cards and game-over screens are functions of
 * *behaviour over time*, so this file names the states that behaviour passes
 * through and `stubEngine.ts` walks them on a fixed timeline. **Track B renders
 * fixtures; it never simulates.**
 *
 * Three rules hold for every constant below.
 *
 * - **No §8 literal.** Patience, arrival gap, lockout, hearts, the queue cap,
 *   the combo range, the base points and the shift-clear bonus are all read from
 *   `src/game/config.ts` (§10.4). The single-source test at the foot of
 *   `tests/contract/config.test.ts` names this file as the one it guards.
 * - **Structurally valid.** Every fixture satisfies R22 (`queue` ascending by
 *   `id`), §8.7's queue cap, §8.8's `comboTenths` range, R20's integer
 *   milliseconds, and `activeId` is either `null` or a customer actually in the
 *   queue. `tests/dev/fixtures.test.ts` asserts all of that over `FIXTURES`
 *   rather than over a hand-listed subset.
 * - **Deeply frozen.** Two gallery entries rendering the same fixture must not
 *   be able to corrupt each other, and a component that mutates state it was
 *   handed is a bug worth finding at M1b rather than at M2.
 *
 * The mood bands are never re-derived here: `view.moodFor` is §9.6's single
 * place for the patience ratio, so the fixtures set a patience and the test
 * asserts what `moodFor` makes of it.
 *
 * This whole directory is deleted by an M2 story once `EngineContext` names the
 * real engine (§10.5).
 */
import { CONFIG, gapMsFor, patienceMsFor } from '../game/config';
import type { Customer, Drink, GameState, ServeResult } from '../game/types';

/**
 * Freezes the object graph rather than only its root, so a frozen fixture's
 * `queue`, its `Customer`s and its `shiftResults` rows are frozen too.
 *
 * **This is a deliberate copy of `deepFreeze` in `src/game/config.ts`** (see the
 * original there for the no-cycle-guard reasoning, which holds here for the same
 * reason: it is applied only to literals built in this module, which cannot
 * reference themselves). It is copied rather than exported and shared because
 * `config.ts` is part of the frozen §10.4 contract — Sprint 3 froze its public
 * surface — and because `src/dev/` is deleted whole by an M2 story, so widening
 * that surface for a helper with a scheduled death would be the worse trade.
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

/** The four §8.5 shift indices this catalogue uses, named rather than spelled. */
const BREAKFAST = 0;
const LUNCH = 1;
const TEA = 2;

/** §8.5's breakfast patience — the `maxPatienceMs` every fixture customer carries. */
const MAX_PATIENCE_MS = patienceMsFor(BREAKFAST, 1);

/**
 * The dwell between two entries of the scripted replay, and the catalogue's
 * stand-in arrival gap. §8.5's first breakfast gap is the natural beat: it is a
 * real config value, so no timeline number is a literal, and it is long enough
 * that a human stepping the gallery sees each state.
 */
export const REPLAY_STEP_MS = gapMsFor(BREAKFAST, 1);

/**
 * Where each stop of the scripted replay sits, in milliseconds from its start.
 *
 * `stubEngine.ts` reuses `tickRemainderMs` as the replay cursor — see its
 * header for why that is the only field available — so the fixtures that are
 * *on* the replay carry their own position in it. That is what makes
 * `applyAction(SHIFT_BREAK, { type: 'DISMISS_BREAK' })` land on the game-over
 * card rather than back at the top of the script: a fixture handed straight to
 * the stub already knows where it is. `tests/dev/fixtures.test.ts` asserts the
 * two agree entry by entry.
 *
 * ## Render-only fixtures, and why the distinction matters
 *
 * Only a fixture with a cursor is **drivable** — safe to hand to `tick` or
 * `applyAction`. Those are the seven `TIMELINE` states plus `SHIFT_BREAK_CLEARED`,
 * which is parked at the `break` stop so that Track B can wire a Continue button
 * to the one Endless break card and have it move *forward*.
 *
 * Every other fixture is **render-only**: a snapshot for a component, a story or
 * a gallery tile to draw, and nothing more. They inherit `BASE`'s
 * `tickRemainderMs: 0`, which is the `empty` stop, so handing one to the stub
 * rewinds it to the top of the script — `tick(MID_LOCKOUT, 16)` returns an empty
 * queue with no lockout. That is not a bug in the stub: the replay is a
 * slideshow with one cursor, and a state that never sat on the slideshow has no
 * position in it. Render them; do not drive them.
 */
const REPLAY_AT = {
  empty: 0,
  calm: REPLAY_STEP_MS,
  impatient: REPLAY_STEP_MS * 2,
  angry: REPLAY_STEP_MS * 3,
  walkout: REPLAY_STEP_MS * 4,
  break: REPLAY_STEP_MS * 5,
  gameover: REPLAY_STEP_MS * 6,
} as const;

/** §8.8 stores the combo as integer tenths; this is the divisor, not a tunable. */
const TENTHS_PER_UNIT = 10;

/**
 * §9.6's patience ratios. The two **boundary** values are the point of this
 * list: §9.6 makes both intervals half-open downward, so `p = 0.60` is
 * `impatient` and `p = 0.30` is `angry`, and a fixture that lands on neither
 * boundary exactly would let a `>=`/`>` slip past Track B's tests.
 *
 * These are §9.6 display bands, not §8 tuning values, so they belong here rather
 * than in `config.ts` — and `moodFor` remains the only place the ratio is
 * turned into a band.
 */
const FULL_RATIO = 1;
const CALM_RATIO = 0.8;
const CALM_IMPATIENT_BOUNDARY_RATIO = 0.6;
const IMPATIENT_RATIO = 0.45;
const IMPATIENT_ANGRY_BOUNDARY_RATIO = 0.3;
const ANGRY_RATIO = 0.15;

/** Integer milliseconds (R20) for a fraction of a customer's maximum patience. */
function patienceAt(ratio: number): number {
  return Math.round(MAX_PATIENCE_MS * ratio);
}

/** §8.8's points for one correct serve at the given integer combo. */
function pointsAt(comboTenths: number): number {
  return Math.round((CONFIG.BASE_POINTS * comboTenths) / TENTHS_PER_UNIT);
}

/**
 * A plausible running score for a run that has served `served` customers.
 *
 * The stub never scores — M1a's engine owns §8.8's arithmetic, and a second
 * implementation of it here would be a fiction a Track B test could go green
 * against. This exists only so the break and game-over cards render a number
 * built from §8.8's own constants rather than from a magic literal.
 */
function scoreFor(served: number, comboTenths: number): number {
  return served * pointsAt(comboTenths);
}

/** §7.1's all-defaults drink — R1's builder, and the plainest possible order. */
export const PLAIN_KOPI: Drink = deepFreeze({
  base: 'kopi',
  milk: 'condensed',
  sugar: 'normal',
  strength: 'normal',
  temperature: 'hot',
  vessel: 'cup',
});

/** One non-default slot, so it is inside §8.6's tier-1 budget, as breakfast is. */
const KOPI_C: Drink = deepFreeze({ ...PLAIN_KOPI, milk: 'evaporated' });

/** Likewise tier 1: `base` is always stated and never charged to the budget. */
const TEH_PENG: Drink = deepFreeze({ ...PLAIN_KOPI, base: 'teh', temperature: 'peng' });

/**
 * A drink the player might be *holding* when a wrong serve lands. R18 lets the
 * builder hold anything, and this one matches none of the three orders above.
 */
const WRONG_BUILD: Drink = deepFreeze({ ...PLAIN_KOPI, milk: 'none', sugar: 'ga-dai' });

function customer(id: number, order: Drink, patienceMs: number, fumbled = false): Customer {
  return { id, order, maxPatienceMs: MAX_PATIENCE_MS, patienceMs, fumbled };
}

/** `n` copies of one §8.9 glyph, for building a share grid without a literal run. */
function repeat(result: ServeResult, count: number): ServeResult[] {
  return Array.from({ length: count }, () => result);
}

/** Every customer of a grid who left served rather than walked out (§8.9). */
function servedIn(results: readonly (readonly ServeResult[])[]): number {
  return results.flat().filter((glyph) => glyph !== 'walkout').length;
}

/**
 * The state every fixture is a delta from: a fresh Daily run, first shift, no
 * one in the queue yet.
 *
 * **Daily throughout**, because R16's truncated share grid — the one thing the
 * game-over fixture exists to prove — is a Daily claim: §8.9's 34-customer day
 * is what "fewer than 34 glyphs" is measured against. The one Endless fixture is
 * `SHIFT_BREAK_CLEARED`, which is where Track B can see a break card that is not
 * on the Daily path.
 */
const BASE: GameState = {
  phase: 'playing',
  mode: 'daily',
  queue: [],
  activeId: null,
  builder: PLAIN_KOPI,
  hearts: CONFIG.HEARTS,
  comboTenths: CONFIG.COMBO_MIN_TENTHS,
  bestComboTenths: CONFIG.COMBO_MIN_TENTHS,
  score: 0,
  shiftIndex: BREAKFAST,
  spawnedInShift: 0,
  servedInShift: 0,
  walkoutsInShift: 0,
  servesAttempted: 0,
  servesCorrect: 0,
  lockoutMs: 0,
  nextArrivalMs: gapMsFor(BREAKFAST, 1),
  nextCustomerId: 1,
  rngState: 0,
  tickRemainderMs: 0,
  shiftResults: [[]],
  frameEvents: [],
};

function fixture(overrides: Partial<GameState>): GameState {
  return deepFreeze({ ...BASE, ...overrides });
}

/** A single queued customer, focused, one gap into the shift. */
function oneWaiting(patienceMs: number, fumbled = false): Partial<GameState> {
  return {
    queue: [customer(1, PLAIN_KOPI, patienceMs, fumbled)],
    activeId: 1,
    spawnedInShift: 1,
    nextCustomerId: 2,
    nextArrivalMs: gapMsFor(BREAKFAST, 2),
  };
}

/* ------------------------------------------------------------------ *
 * §10.5's catalogue.
 * ------------------------------------------------------------------ */

/** Nobody waiting. The §9.5 queue column has to read as deliberate, not broken. */
export const EMPTY_QUEUE: GameState = fixture({ tickRemainderMs: REPLAY_AT.empty });

/** One customer, just arrived at full patience. */
export const ONE_CUSTOMER: GameState = fixture(oneWaiting(patienceAt(FULL_RATIO)));

/** Two customers, the front one already impatient. R22: ascending by `id`. */
export const TWO_CUSTOMERS: GameState = fixture({
  queue: [
    customer(1, PLAIN_KOPI, patienceAt(IMPATIENT_RATIO)),
    customer(2, KOPI_C, patienceAt(FULL_RATIO)),
  ],
  activeId: 1,
  spawnedInShift: 2,
  nextCustomerId: 3,
  nextArrivalMs: gapMsFor(BREAKFAST, 3),
});

/**
 * §8.7's cap. `nextArrivalMs` is 0 because R10 suspends arrivals while the queue
 * is full — the timer is not counting down towards a fourth card.
 */
export const THREE_CUSTOMERS: GameState = fixture({
  queue: [
    customer(1, PLAIN_KOPI, patienceAt(ANGRY_RATIO)),
    customer(2, KOPI_C, patienceAt(IMPATIENT_RATIO)),
    customer(3, TEH_PENG, patienceAt(FULL_RATIO)),
  ],
  activeId: 1,
  spawnedInShift: 3,
  nextCustomerId: 4,
  nextArrivalMs: 0,
});

/** §9.6's `calm` band — `p > 0.60`. */
export const MOOD_CALM: GameState = fixture({
  ...oneWaiting(patienceAt(CALM_RATIO)),
  tickRemainderMs: REPLAY_AT.calm,
});

/** §9.6's `impatient` band — `0.30 < p ≤ 0.60`. */
export const MOOD_IMPATIENT: GameState = fixture({
  ...oneWaiting(patienceAt(IMPATIENT_RATIO)),
  tickRemainderMs: REPLAY_AT.impatient,
});

/** §9.6's `angry` band — `p ≤ 0.30`. */
export const MOOD_ANGRY: GameState = fixture({
  ...oneWaiting(patienceAt(ANGRY_RATIO)),
  tickRemainderMs: REPLAY_AT.angry,
});

/**
 * `p = 0.60` **exactly**. §9.6 puts both boundary values in the *lower* band, so
 * `moodFor` must answer `impatient` here, not `calm`.
 */
export const MOOD_BOUNDARY_IMPATIENT: GameState = fixture(
  oneWaiting(patienceAt(CALM_IMPATIENT_BOUNDARY_RATIO)),
);

/** `p = 0.30` **exactly** — `angry`, by the same rule. */
export const MOOD_BOUNDARY_ANGRY: GameState = fixture(
  oneWaiting(patienceAt(IMPATIENT_ANGRY_BOUNDARY_RATIO)),
);

/**
 * A queue with nothing focused. R3 re-resolves focus to the front of the queue
 * automatically, so this is the frame before that lands — and the state the
 * §9.5 layout must not render as three collapsed cards with no expanded one.
 */
export const NO_ACTIVE: GameState = fixture({
  queue: [
    customer(1, PLAIN_KOPI, patienceAt(IMPATIENT_RATIO)),
    customer(2, KOPI_C, patienceAt(CALM_RATIO)),
  ],
  activeId: null,
  spawnedInShift: 2,
  nextCustomerId: 3,
  nextArrivalMs: gapMsFor(BREAKFAST, 3),
});

/**
 * Part-way through R5's lockout, which §9.7 requires to be *visible*: the SERVE
 * button shows a depleting bar and the six slot rows are `aria-disabled`. Half
 * the lockout is gone, so the bar is mid-sweep rather than at either end.
 */
export const MID_LOCKOUT: GameState = fixture({
  ...oneWaiting(patienceAt(IMPATIENT_RATIO), true),
  builder: WRONG_BUILD,
  lockoutMs: Math.round(CONFIG.LOCKOUT_MS / 2),
  servesAttempted: 1,
  servesCorrect: 0,
});

/**
 * The frame immediately after a wrong serve, satisfying R7 and R25.
 *
 * It is `MOOD_CALM`'s customer one wrong serve later, which is what makes R7
 * assertable rather than asserted-by-inspection: `tests/dev/fixtures.test.ts`
 * recomputes `max(patienceMs − WRONG_SERVE_PENALTY_FRACTION × maxPatienceMs,
 * PATIENCE_FLOOR_MS)` from `MOOD_CALM` and this file's config imports, and R7's
 * closing clause — a wrong serve can never cause a walkout — is why the floor is
 * in the expression at all.
 *
 * R25: `servesAttempted` counts the serve, `servesCorrect` does not.
 */
export const POST_WRONG_SERVE: GameState = fixture({
  ...oneWaiting(
    Math.max(
      Math.round(patienceAt(CALM_RATIO) - CONFIG.WRONG_SERVE_PENALTY_FRACTION * MAX_PATIENCE_MS),
      CONFIG.PATIENCE_FLOOR_MS,
    ),
    true,
  ),
  builder: WRONG_BUILD,
  comboTenths: CONFIG.COMBO_MIN_TENTHS,
  lockoutMs: CONFIG.LOCKOUT_MS,
  servesAttempted: 1,
  servesCorrect: 0,
  frameEvents: [{ type: 'fumbled', customerId: 1 }],
});

/**
 * The frame a customer runs out of patience on: R21 resolves the walkout, costs
 * a heart and resets the combo, and R3 leaves `activeId` null because the queue
 * is now empty. §8.9's grid gains its first 🟥.
 */
export const AFTER_WALKOUT: GameState = fixture({
  queue: [],
  activeId: null,
  hearts: CONFIG.HEARTS - 1,
  comboTenths: CONFIG.COMBO_MIN_TENTHS,
  spawnedInShift: 1,
  walkoutsInShift: 1,
  nextCustomerId: 2,
  nextArrivalMs: gapMsFor(BREAKFAST, 2),
  shiftResults: [['walkout']],
  tickRemainderMs: REPLAY_AT.walkout,
  frameEvents: [
    { type: 'walkout', customerId: 1 },
    { type: 'heartLost', remaining: CONFIG.HEARTS - 1 },
  ],
});

/**
 * §8.5's rest beat, R15's *negative* case: breakfast ended with one walkout, so
 * no `shiftCleared` event and no bonus. The break card still has to render, and
 * "no bonus" is the harder of the two states to get right.
 */
const BREAKFAST_GRID: readonly ServeResult[] = [
  'walkout',
  ...repeat('clean', CONFIG.SHIFTS[BREAKFAST].customers - 1),
];

const BREAK_COMBO_TENTHS =
  CONFIG.COMBO_MIN_TENTHS + servedIn([BREAKFAST_GRID]) * CONFIG.COMBO_STEP_TENTHS;

export const SHIFT_BREAK: GameState = fixture({
  phase: 'break',
  queue: [],
  activeId: null,
  hearts: CONFIG.HEARTS - 1,
  comboTenths: BREAK_COMBO_TENTHS,
  bestComboTenths: BREAK_COMBO_TENTHS,
  score: scoreFor(servedIn([BREAKFAST_GRID]), BREAK_COMBO_TENTHS),
  spawnedInShift: CONFIG.SHIFTS[BREAKFAST].customers,
  servedInShift: servedIn([BREAKFAST_GRID]),
  walkoutsInShift: 1,
  servesAttempted: servedIn([BREAKFAST_GRID]),
  servesCorrect: servedIn([BREAKFAST_GRID]),
  nextCustomerId: CONFIG.SHIFTS[BREAKFAST].customers + 1,
  nextArrivalMs: 0,
  shiftResults: [[...BREAKFAST_GRID]],
  tickRemainderMs: REPLAY_AT.break,
});

/**
 * R15's *positive* case, and the one Endless fixture: a shift cleared with zero
 * walkouts, so the +`SHIFT_CLEAR_BONUS` lands and the `shiftCleared` event is in
 * `frameEvents` for §9.5's break card to celebrate.
 *
 * It is not on the `TIMELINE`, but it carries the `break` stop's cursor anyway,
 * because it is the only Endless break card Track B has: a Continue button wired
 * to it must step the replay *forward* to the game-over card, exactly as it does
 * from `SHIFT_BREAK`, rather than rewinding to the top of the script.
 */
const CLEARED_GRID: readonly ServeResult[] = repeat('clean', CONFIG.SHIFTS[BREAKFAST].customers);

const CLEARED_COMBO_TENTHS = Math.min(
  CONFIG.COMBO_MIN_TENTHS + servedIn([CLEARED_GRID]) * CONFIG.COMBO_STEP_TENTHS,
  CONFIG.COMBO_MAX_TENTHS,
);

export const SHIFT_BREAK_CLEARED: GameState = fixture({
  phase: 'break',
  mode: 'endless',
  queue: [],
  activeId: null,
  comboTenths: CLEARED_COMBO_TENTHS,
  bestComboTenths: CLEARED_COMBO_TENTHS,
  score: scoreFor(servedIn([CLEARED_GRID]), CLEARED_COMBO_TENTHS) + CONFIG.SHIFT_CLEAR_BONUS,
  spawnedInShift: CONFIG.SHIFTS[BREAKFAST].customers,
  servedInShift: servedIn([CLEARED_GRID]),
  servesAttempted: servedIn([CLEARED_GRID]),
  servesCorrect: servedIn([CLEARED_GRID]),
  nextCustomerId: CONFIG.SHIFTS[BREAKFAST].customers + 1,
  nextArrivalMs: 0,
  shiftResults: [[...CLEARED_GRID]],
  tickRemainderMs: REPLAY_AT.break,
  frameEvents: [{ type: 'shiftCleared', shiftIndex: BREAKFAST, bonus: CONFIG.SHIFT_CLEAR_BONUS }],
});

/**
 * R16, and the reason `shiftResults` is an array of arrays rather than a flat
 * list (§8.9): a Daily run that dies part-way through tea produces a share grid
 * *shorter* than 34 glyphs which is still correctly grouped 6 · 8 · 4.
 *
 * The third heart goes on tea's fourth customer, so the run ends there:
 * customers still queued are discarded and produce no glyph. One lunch customer
 * carries the 🟨 `fumbled` state, so all three §8.9 glyphs are reachable from
 * this one fixture.
 */
const GAME_OVER_GRID: readonly (readonly ServeResult[])[] = [
  BREAKFAST_GRID,
  [...repeat('clean', CONFIG.SHIFTS[LUNCH].customers - 2), 'fumbled', 'walkout'],
  [...repeat('clean', 3), 'walkout'],
];

const GAME_OVER_COMBO_TENTHS = Math.min(
  CONFIG.COMBO_MIN_TENTHS + CONFIG.SHIFTS[LUNCH].customers * CONFIG.COMBO_STEP_TENTHS,
  CONFIG.COMBO_MAX_TENTHS,
);

const GAME_OVER_SERVED = servedIn(GAME_OVER_GRID);

export const GAME_OVER: GameState = fixture({
  phase: 'gameover',
  queue: [],
  activeId: null,
  hearts: 0,
  comboTenths: CONFIG.COMBO_MIN_TENTHS,
  bestComboTenths: GAME_OVER_COMBO_TENTHS,
  score: scoreFor(GAME_OVER_SERVED, GAME_OVER_COMBO_TENTHS),
  shiftIndex: TEA,
  spawnedInShift: GAME_OVER_GRID[TEA].length,
  servedInShift: servedIn([GAME_OVER_GRID[TEA]]),
  walkoutsInShift: 1,
  // One customer was fumbled before being served, so that serve took two
  // attempts — R25 counts both.
  servesAttempted: GAME_OVER_SERVED + 1,
  servesCorrect: GAME_OVER_SERVED,
  lockoutMs: 0,
  nextArrivalMs: 0,
  nextCustomerId: GAME_OVER_GRID.flat().length + 1,
  shiftResults: GAME_OVER_GRID.map((shift) => [...shift]),
  tickRemainderMs: REPLAY_AT.gameover,
  frameEvents: [
    { type: 'walkout', customerId: GAME_OVER_GRID.flat().length },
    { type: 'heartLost', remaining: 0 },
    { type: 'gameOver' },
  ],
});

/**
 * The catalogue, by name. Tests assert structural validity over *this* rather
 * than over a hand-listed subset, so a fixture added later cannot skip the
 * check by being forgotten, and the gallery has one thing to enumerate.
 */
export const FIXTURES = Object.freeze({
  EMPTY_QUEUE,
  ONE_CUSTOMER,
  TWO_CUSTOMERS,
  THREE_CUSTOMERS,
  MOOD_CALM,
  MOOD_IMPATIENT,
  MOOD_ANGRY,
  MOOD_BOUNDARY_IMPATIENT,
  MOOD_BOUNDARY_ANGRY,
  NO_ACTIVE,
  MID_LOCKOUT,
  POST_WRONG_SERVE,
  AFTER_WALKOUT,
  SHIFT_BREAK,
  SHIFT_BREAK_CLEARED,
  GAME_OVER,
});

/** A named stop on the scripted replay `stubEngine.ts` walks. */
export interface TimelineEntry {
  /** Stable name, for the gallery and for test failure messages. */
  readonly name: string;
  /** Milliseconds from the start of the replay at which this entry takes over. */
  readonly atMs: number;
  readonly state: GameState;
}

/**
 * §10.5's scripted replay: **calm → impatient → angry → walkout → break →
 * gameover**, one entry per `REPLAY_STEP_MS`.
 *
 * It is a slideshow, not a simulation. What it guarantees is the *sequence* —
 * every state Track B has to render is reachable by advancing time and nothing
 * else — and two invariants R22 asks for along the way: `queue` stays ascending
 * by `id`, and `nextCustomerId` never goes backwards.
 */
export const TIMELINE: readonly TimelineEntry[] = Object.freeze(
  (
    [
      ['empty', REPLAY_AT.empty, EMPTY_QUEUE],
      ['calm', REPLAY_AT.calm, MOOD_CALM],
      ['impatient', REPLAY_AT.impatient, MOOD_IMPATIENT],
      ['angry', REPLAY_AT.angry, MOOD_ANGRY],
      ['walkout', REPLAY_AT.walkout, AFTER_WALKOUT],
      ['break', REPLAY_AT.break, SHIFT_BREAK],
      ['gameover', REPLAY_AT.gameover, GAME_OVER],
    ] as const
  ).map(([name, atMs, state]) => Object.freeze({ name, atMs, state })),
);
