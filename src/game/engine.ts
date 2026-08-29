/**
 * Part 3 of §10.5's three-part track seam: the three signatures §10.3 specifies,
 * committed and typechecked now so that M1a fills bodies rather than negotiating
 * shapes.
 *
 * §10.3 makes the engine a **pure reducer**: time is an input rather than
 * ambient state, and the PRNG state lives inside `GameState`. That is what makes
 * an entire shift a pure fold over a list of ticks and actions — and what makes
 * the 100%-coverage promise survivable once the queue exists.
 *
 * **Every body throws.** A stub that returned a plausible `GameState` would be
 * the worst outcome available: a Track A story could ship against it and a
 * Playwright spec could go green against a fiction. Throwing names the story
 * that owns the body, so whoever hits it knows where the work lives instead of
 * debugging a silent zero.
 *
 * The three bodies land in M1a's Sprint 21 — `tick` in S21-1, `applyAction` and
 * `createInitialState` in S21-2, which implements one in terms of the other so
 * that §10.3's "one reset path, not two" holds by construction.
 */
import type { Action, GameState, Mode } from './types';

/**
 * The shared failure. It is a plain `Error` rather than a subclass: nothing
 * catches it, `instanceof Error` is what a test can assert, and a bespoke error
 * class on the frozen seam would be a seventh thing for both tracks to import.
 *
 * `args` is accepted and deliberately not stringified. Its purpose is to let the
 * three exports below declare §10.3's parameter names *verbatim* — the contract
 * should read straight off the source — without every one of them tripping
 * `noUnusedParameters`. It returns `never`, so each body is a single covered
 * line and `engine.ts` sits at 100% under §10.7's `perFile` threshold from this
 * sprint onward.
 */
function notImplemented(signature: string, story: string, args: readonly unknown[]): never {
  throw new Error(
    `NotImplemented: ${signature} is Sprint 3's frozen signature only — ` +
      `${story} implements it (${String(args.length)} argument(s) received). ` +
      `src/game/engine.ts must not be called before then.`,
  );
}

/**
 * §10.3's pre-title bootstrap. Every actual run begins with `START_RUN` instead;
 * S21-2 implements the two as one reset path so that
 * `applyAction(state, { type: 'START_RUN', mode, seed })` equals
 * `createInitialState(mode, seed)` by construction.
 *
 * Endless seeds are supplied by the React layer as a fresh value per run; Daily
 * seeds come from §8.9's date hash.
 */
export function createInitialState(mode: Mode, seed: number): GameState {
  return notImplemented('createInitialState(mode, seed)', 'S21-2', [mode, seed]);
}

/**
 * §10.3's clock. R20 quantises: `dtMs` accumulates into `tickRemainderMs` and
 * whole `TICK_MS` steps are applied with the remainder carried, so a single call
 * may spawn and walk out several customers — which is what lets Playwright
 * fast-forward a shift instead of waiting 18 real seconds per customer.
 *
 * §10.3's identity clause is part of the contract S21-1 must satisfy: the
 * identical reference comes back when `phase !== 'playing'` or `dtMs === 0`, and
 * `builder` keeps its identity across a run of ticks so the §9.4 SVG preview is
 * not rebuilt 60 times a second.
 */
export function tick(state: GameState, dtMs: number): GameState {
  return notImplemented('tick(state, dtMs)', 'S21-1', [state, dtMs]);
}

/**
 * §10.3's reducer over the seven `Action` variants. R5 ignores every player
 * action while `lockoutMs > 0`, R19 ignores everything but `RESUME` while
 * paused, and R21 fixes the pipeline order — all of which S21-2 owns.
 *
 * `SET_SLOT` writes through the generic `setSlot<K>` helper in `types.ts`, which
 * §10.3 makes the single place the unavoidable cast may live.
 */
export function applyAction(state: GameState, action: Action): GameState {
  return notImplemented('applyAction(state, action)', 'S21-2', [state, action]);
}
