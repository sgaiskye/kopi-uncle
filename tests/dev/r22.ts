/**
 * R22, as a reusable property.
 *
 * > `queue` is always ascending by `id`, and `nextCustomerId` is monotonic — so
 * > id order *is* arrival order, and `queue[0]` is the "front" R3 refers to.
 * > Every removal path preserves relative order. **Assert as a property test on
 * > both the engine and the M0 stub, so the two cannot silently disagree.**
 *
 * S9-1 runs it against `src/dev/stubEngine.ts`. **M1a re-uses this module
 * verbatim against `src/game/engine.ts`** — `runR22Property` takes the three
 * frozen signatures as a parameter for exactly that reason, so the two
 * implementations are held to one written-once property rather than to two
 * tests that could drift apart.
 *
 * It lives under `tests/dev/` because that is the directory S9-1 owns. When M2
 * deletes `src/dev/` it should move rather than go with it — `tests/support/` is
 * its home once the harness sprint's directory is free.
 *
 * The driver is a deterministic LCG rather than `Math.random()`: a property test
 * that fails on one CI run in fifty and cannot be reproduced is worse than no
 * property test. Seeds are explicit, so a failure names the exact sequence.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/game/config';
import type { Action, GameState, Mode } from '../../src/game/types';

/** The three signatures §10.3 freezes — the shape both implementations share. */
export interface EngineLike {
  createInitialState(mode: Mode, seed: number): GameState;
  tick(state: GameState, dtMs: number): GameState;
  applyAction(state: GameState, action: Action): GameState;
}

/**
 * A Lehmer generator, for the driver only. It never touches game state, so it is
 * not a second PRNG competing with §10.3's `rngState` — it is the list of steps
 * the fold is run over, chosen reproducibly.
 */
const LCG_MULTIPLIER = 48271;
const LCG_MODULUS = 2147483647;

function nextSeed(seed: number): number {
  return (seed * LCG_MULTIPLIER) % LCG_MODULUS;
}

/**
 * One `SET_SLOT` per slot, written out as six literals rather than assembled
 * from a slot name and a lookup. §10.3 is explicit that `SetSlot` does not
 * narrow on its own, so a `{ slot, value }` pair built from a union does not
 * typecheck — and the one place the cast that would fix it may live is
 * `setSlot` in `types.ts`. Six literals cost nothing and spend nothing.
 */
const SET_SLOT_ACTIONS: readonly Action[] = [
  { type: 'SET_SLOT', slot: 'base', value: 'teh' },
  { type: 'SET_SLOT', slot: 'milk', value: 'evaporated' },
  { type: 'SET_SLOT', slot: 'sugar', value: 'ga-dai' },
  { type: 'SET_SLOT', slot: 'strength', value: 'gao' },
  { type: 'SET_SLOT', slot: 'temperature', value: 'peng' },
  { type: 'SET_SLOT', slot: 'vessel', value: 'bag' },
];

/**
 * One step of the fold: either a tick or an action, chosen from `seed`.
 *
 * `START_RUN` is deliberately absent. It resets `nextCustomerId` to the start of
 * a fresh run, which is not a monotonicity break — R22's claim is *within* a
 * run — and including it would make the property assert something R22 does not
 * say. Every other variant is in the mix, including the ones R5 and R19 are
 * supposed to swallow.
 */
function stepFrom(seed: number, state: GameState): { action: Action | null; dtMs: number } {
  const choice = seed % 8;
  if (choice === 0) return { action: null, dtMs: CONFIG.TICK_MS };
  if (choice === 1) return { action: null, dtMs: CONFIG.MAX_FRAME_MS };
  if (choice === 2) return { action: { type: 'SERVE' }, dtMs: 0 };
  if (choice === 3) return { action: { type: 'DISMISS_BREAK' }, dtMs: 0 };
  if (choice === 4) return { action: { type: 'PAUSE' }, dtMs: 0 };
  if (choice === 5) return { action: { type: 'RESUME' }, dtMs: 0 };
  if (choice === 6) {
    return { action: SET_SLOT_ACTIONS[seed % SET_SLOT_ACTIONS.length], dtMs: 0 };
  }
  // Focus a customer who may or may not be in the queue — R3 lets the player tap
  // any card, and a stale id must not corrupt the order either.
  const front = state.queue.length === 0 ? 1 : state.queue[0].id;
  return { action: { type: 'FOCUS', customerId: front + (seed % 2) }, dtMs: 0 };
}

/** `queue` ascending by `id`, with no duplicates — the "front is `queue[0]`" claim. */
function ascendingById(state: GameState): boolean {
  return state.queue.every(
    (waiting, index) => index === 0 || state.queue[index - 1].id < waiting.id,
  );
}

/**
 * Runs R22 as a property over `steps` folded steps from each of `seeds`.
 *
 * Calling this registers its own `describe`, so a suite adds the property with
 * one line and no local restatement of what R22 says.
 */
export function runR22Property(
  label: string,
  engine: EngineLike,
  options: {
    readonly modes?: readonly Mode[];
    readonly seeds?: readonly number[];
    readonly steps?: number;
  } = {},
): void {
  const modes = options.modes ?? (['endless', 'daily'] as const);
  const seeds = options.seeds ?? [1, 7, 1337, 20260829];
  const steps = options.steps ?? 200;

  describe(`R22 — queue order and id monotonicity (${label})`, () => {
    for (const mode of modes) {
      it.each(seeds)(`holds across ${String(steps)} folded steps in ${mode}, seed %i`, (seed) => {
        let state = engine.createInitialState(mode, seed);
        let driver = seed;
        let highestNextCustomerId = state.nextCustomerId;

        expect(ascendingById(state), 'the initial state is already out of order').toBe(true);

        for (let index = 0; index < steps; index += 1) {
          driver = nextSeed(driver);
          const { action, dtMs } = stepFrom(driver, state);
          const before = state;
          state = action === null ? engine.tick(state, dtMs) : engine.applyAction(state, action);

          const where = `${mode}/seed ${String(seed)}/step ${String(index)} (${
            action === null ? `tick ${String(dtMs)}` : action.type
          })`;

          expect(ascendingById(state), `${where}: queue is not ascending by id`).toBe(true);
          expect(
            state.nextCustomerId,
            `${where}: nextCustomerId went backwards from ${String(before.nextCustomerId)}`,
          ).toBeGreaterThanOrEqual(highestNextCustomerId);
          expect(state.queue.length, `${where}: queue exceeded §8.7's cap`).toBeLessThanOrEqual(
            CONFIG.QUEUE_CAP,
          );

          highestNextCustomerId = state.nextCustomerId;
        }
      });
    }

    it('is not vacuous: the fold actually reaches a non-empty queue', () => {
      let state = engine.createInitialState('daily', seeds[0]);
      let seen = state.queue.length;
      for (let index = 0; index < steps; index += 1) {
        state = engine.tick(state, CONFIG.MAX_FRAME_MS);
        seen = Math.max(seen, state.queue.length);
      }
      expect(seen, 'no step of the fold ever put a customer in the queue').toBeGreaterThan(0);
    });
  });
}
