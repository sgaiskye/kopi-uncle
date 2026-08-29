/**
 * The frozen contract's type surface (PRD §10.3), part 1 of §10.5's three-part
 * seam. Both tracks compile against this file, so a contract drift shows up as
 * a red `npm run typecheck` rather than at M2 integration.
 *
 * Nothing here is a value except `setSlot`, which §10.3 requires the contract
 * to ship because `SetSlot` does not narrow on its own — see the note above it.
 */

export type Phase = 'title' | 'playing' | 'paused' | 'break' | 'gameover';
export type Mode = 'endless' | 'daily';
export type Tier = 1 | 2 | 3;
export type ShiftId = 'breakfast' | 'lunch' | 'tea' | 'supper';
export type Mood = 'calm' | 'impatient' | 'angry';
export type ServeResult = 'clean' | 'fumbled' | 'walkout';

export type GameEvent =
  | { type: 'arrived'; customerId: number }
  | { type: 'served'; customerId: number; points: number }
  | { type: 'fumbled'; customerId: number }
  | { type: 'walkout'; customerId: number }
  | { type: 'heartLost'; remaining: number }
  | { type: 'shiftCleared'; shiftIndex: number; bonus: number }
  | { type: 'gameOver' };

/* The six independent slots of §7.1. Declaration order is §7.2's canonical
 * spoken order, which §7.5 also makes the stable enumeration order. */
export type Base = 'kopi' | 'teh';
export type Milk = 'condensed' | 'evaporated' | 'none';
export type Sugar = 'normal' | 'siew-dai' | 'ga-dai' | 'kosong';
export type Strength = 'normal' | 'gao' | 'po';
export type Temperature = 'hot' | 'peng';
export type Vessel = 'cup' | 'bag';

export interface Drink {
  base: Base;
  milk: Milk;
  sugar: Sugar;
  strength: Strength;
  temperature: Temperature;
  vessel: Vessel;
}

export interface Customer {
  id: number;
  order: Drink;
  maxPatienceMs: number;
  patienceMs: number;
  fumbled: boolean; // drives the 🟨 share state
}

export interface GameState {
  phase: Phase;
  mode: Mode;
  queue: Customer[]; // length 0..3, always ascending by id — R22
  activeId: number | null;
  builder: Drink; // persists across serves — see §8.2
  hearts: number;
  comboTenths: number; // integer 10..30 — see §8.8
  bestComboTenths: number;
  score: number;
  shiftIndex: number; // 0..3, then pinned at 3 in Endless
  spawnedInShift: number;
  servedInShift: number;
  walkoutsInShift: number;
  servesAttempted: number; // for §8.10 accuracy
  servesCorrect: number;
  lockoutMs: number; // 600ms after a wrong serve
  nextArrivalMs: number;
  nextCustomerId: number;
  rngState: number; // mulberry32 state — keeps tick pure
  tickRemainderMs: number; // sub-step carry — see R20
  shiftResults: ServeResult[][]; // one inner array per shift — see §8.9
  frameEvents: GameEvent[]; // OVERWRITTEN every call, never appended — R21
}

export type SetSlot = {
  [K in keyof Drink]: { type: 'SET_SLOT'; slot: K; value: Drink[K] };
}[keyof Drink];

export type Action =
  | { type: 'START_RUN'; mode: Mode; seed: number }
  | { type: 'FOCUS'; customerId: number }
  | SetSlot
  | { type: 'SERVE' }
  | { type: 'DISMISS_BREAK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' };

/**
 * The declared `Action` discriminants, listed once so exhaustiveness can be
 * proven at compile time instead of by a runtime `default: throw` arm, which
 * §10.7 bans as an unreachable line.
 */
export type ActionType =
  'START_RUN' | 'FOCUS' | 'SET_SLOT' | 'SERVE' | 'DISMISS_BREAK' | 'PAUSE' | 'RESUME';

/**
 * `never` while every variant of `Action` is listed in `ActionType`. Add a
 * variant without listing it and `UnhandledActionType` widens, which reds both
 * this alias' constraint and the `satisfies never` assignment in
 * `tests/contract/types.test.ts`. Types only — zero runtime.
 */
type MustBeNever<T extends never> = T;
export type UnhandledActionType = Exclude<Action['type'], ActionType>;
export type ActionTypesAreExhaustive = MustBeNever<UnhandledActionType>;

/**
 * `SetSlot` does not narrow on its own (§10.3): destructuring `{ slot, value }`
 * from the union gives TypeScript `keyof Drink` and a union of all six value
 * types, so `draft[slot] = value` does not typecheck under `strict`.
 *
 * This generic helper is therefore the **single place in the codebase where
 * §10.3's unavoidable cast is allowed to live** — the cast budget for the whole
 * of `src/game/` is one, and it is spent here or nowhere. It is currently spent
 * nowhere: with `K` still bound as a type parameter, TypeScript 5.9 relates the
 * computed-key spread to `Drink` on its own, so the assertion §10.3 anticipated
 * is not needed at this call site and writing one would be flagged by
 * `@typescript-eslint/no-unnecessary-type-assertion` — checked, not assumed:
 * `as Drink` here reports "This assertion is unnecessary since it does not
 * change the type of the expression" under that rule, so spending the budget
 * would hand Sprint 2's type-aware linter a red gate it does not own.
 *
 * The cast the budget exists for, and which §10.3 describes, arises one level
 * out: in a reducer that destructures `{ slot, value }` from `SetSlot` and so
 * loses the correlation between them. The fix there is to route the write
 * through this helper rather than to add a second cast.
 * `tests/contract/types.test.ts` asserts the budget is not exceeded.
 *
 * Returns a new `Drink`; every slot other than `slot` is carried over by
 * spread, so the other five stay strictly equal to the input's.
 */
export function setSlot<K extends keyof Drink>(d: Drink, slot: K, value: Drink[K]): Drink {
  return { ...d, [slot]: value };
}
