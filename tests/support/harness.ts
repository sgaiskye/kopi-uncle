/**
 * The fold harness — S10-1 (Sprint 10 — The fold harness).
 *
 * §10.3 makes the engine a pure reducer over `(state, dtMs)` and
 * `(state, action)`. That is only worth anything if a whole shift can be
 * *written down*: this module turns "eighteen seconds of breakfast, then a
 * serve, then a pause" into an ordinary array, so a Track A test is a fold over
 * a list rather than a wait on a clock.
 *
 * Four primitives, and deliberately no more:
 *
 * - `fold(state, steps)` — the base case. Everything else is expressed in terms
 *   of it, so there is one place where a step is dispatched and one place a
 *   later sprint has to look when the dispatch changes.
 * - `advance(state, totalMs)` — the React layer's clamp, replayed. `MAX_FRAME_MS`
 *   is what a real frame is capped at, so a test that wants five seconds gets
 *   the same chunking the app would produce rather than one implausible jumbo
 *   tick. R20's `tickRemainderMs` carry is what makes the chunking invariant:
 *   `advance(s, n)` and a single `tick(s, n)` are the same state.
 * - `runUntil(state, predicate, maxMs)` — the one construct whose *length* is
 *   decided by the engine rather than by its caller, which is exactly why it
 *   carries a budget. A regression that stops spawning customers must fail a
 *   test in milliseconds; without the guard it would hang CI instead, and a hung
 *   job is a far worse signal than a red one.
 * - `expectSameState(actual, expected)` — determinism, asserted on a canonical
 *   serialisation rather than by structural equality. `toEqual` treats
 *   `{ a: undefined }` and `{}` as the same object and ignores key order; both
 *   of those are ways a determinism break could hide, so the comparison is done
 *   on a recursive key-sorted string in which an absent field and an explicit
 *   `undefined` are distinguishable.
 *
 * Neither loop in this file can be made to spin, and that is a property of the
 * module rather than of its callers. `runUntil` has its budget; `advance`
 * rejects a non-finite `totalMs` outright, because an `Infinity` would chunk
 * forever (`Infinity - MAX_FRAME_MS` is `Infinity`) and a `NaN` would fail
 * `remaining > 0` and silently advance nothing — the same hang and the same
 * silence the budget exists to remove.
 *
 * **Imports only `src/game/`.** The harness is the logic track's tool, and the
 * moment it can reach a React component or a hand-written fixture module it
 * stops proving anything about the engine. `harness.test.ts` asserts that
 * boundary over this file's own text.
 *
 * **Every millisecond quantity is read from `src/game/config.ts`** per §10.4 —
 * `TICK_MS` and `MAX_FRAME_MS` are named here, never written as digits, so
 * retuning the clock does not need this file reopened.
 *
 * A note on how this is tested. `src/game/engine.ts` is Sprint 3's frozen
 * signature and every body still throws until S21-1/S21-2 fill them, so
 * `harness.test.ts` exercises these four functions against a substituted
 * reducer that implements R20's quantisation. That is the right seam: what is
 * under test here is the harness's dispatch, chunking, loop guard and
 * comparison — not the engine's rules, which have their own sprint.
 */
import { CONFIG } from '../../src/game/config';
import { applyAction, tick } from '../../src/game/engine';
import type { Action, GameState } from '../../src/game/types';

/**
 * One entry of a scripted shift: either a slice of time or a player action.
 *
 * `{ tick: n }` rather than `{ type: 'TICK', ms: n }` on purpose — `Action` is
 * frozen and owns the `type` discriminant, so a time step has to be told apart
 * by a key `Action` does not have. `'tick' in step` is the whole
 * discrimination, and it cannot drift as `Action` grows variants.
 */
export type Step = { tick: number } | Action;

/**
 * Apply `steps` to `state` in array order, returning the final state.
 *
 * Pure in both directions: `state` is never written to — each step returns a new
 * state and the input is only ever read — and the steps array is only iterated.
 * Order is significant and is the point: a `PAUSE` between two ticks is a
 * different shift from the same two ticks followed by a `PAUSE`.
 */
export function fold(state: GameState, steps: readonly Step[]): GameState {
  return steps.reduce<GameState>(
    (current, step) => ('tick' in step ? tick(current, step.tick) : applyAction(current, step)),
    state,
  );
}

/**
 * Advance `totalMs` the way the React layer would: in chunks of at most
 * `MAX_FRAME_MS`, which is §10.4's clamp on a single frame.
 *
 * The chunking is observationally invariant because R20 accumulates `dtMs` into
 * `tickRemainderMs` and applies whole `TICK_MS` steps with the remainder
 * carried — so no time is lost at a chunk boundary and `advance(s, n)` equals
 * `fold(s, [{ tick: n }])`. `harness.test.ts` asserts that rather than assuming
 * it.
 *
 * A `totalMs` of zero — or any non-positive value — produces no steps at all and
 * returns the input state, matching §10.3's identity clause for `dtMs === 0`
 * instead of dispatching a tick that would have to be ignored anyway.
 *
 * @throws if `totalMs` is not finite. `totalMs` is normally a test author's
 * expression, but it is the primitive most likely to be handed a *computed*
 * duration by a later sprint, and the two non-finite results of such a
 * computation fail in the two worst ways: `Infinity` never decrements
 * `remaining` and so grows the step list until the process dies, and `NaN`
 * fails `remaining > 0` and returns the input state as though the call had
 * succeeded. A thrown error is the only outcome a CI log can act on.
 */
export function advance(state: GameState, totalMs: number): GameState {
  if (!Number.isFinite(totalMs)) {
    throw new Error(
      `advance: totalMs must be a finite number, received ${String(totalMs)}. ` +
        'An infinite total would chunk forever and a NaN would silently advance ' +
        'nothing; both hide an arithmetic bug in the caller instead of reporting it.',
    );
  }

  const steps: Step[] = [];
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, CONFIG.MAX_FRAME_MS);
    steps.push({ tick: chunk });
    remaining -= chunk;
  }
  return fold(state, steps);
}

/**
 * Advance in single `TICK_MS` steps until `predicate` holds, returning the state
 * that satisfied it and how long that took.
 *
 * `elapsedMs` is always a whole multiple of `TICK_MS`, so a caller can assert
 * *when* something happened and not merely that it did. The predicate is tested
 * before the first tick, so a state that already satisfies it costs zero
 * milliseconds rather than one wasted step.
 *
 * The budget is never overrun. A `maxMs` that is not a whole multiple of
 * `TICK_MS` is effectively rounded *down* to one: the loop refuses a tick that
 * would carry `elapsedMs` past `maxMs`, rather than taking it and noticing
 * afterwards. So a returned `elapsedMs` is always at most `maxMs`, and the tick
 * count the failure message quotes never totals more than the budget printed
 * beside it. Both matter in the ordinary case rather than an exotic one —
 * `maxMs` is a round wall-clock number a test author picked, `TICK_MS` is not a
 * divisor of round numbers, and a guard checked after the fact would both return
 * past the budget on success and, on failure, name a tick count whose total
 * exceeds the very budget it is quoting.
 *
 * @throws if `predicate` has not held within `maxMs`. This is the loop guard,
 * and it is not optional: `runUntil` is the one construct here whose length the
 * engine decides, and a regression that stops the queue advancing would
 * otherwise turn a failing assertion into a hung CI job. The message carries the
 * budget, because the first question on reading it is always how long it
 * actually waited.
 *
 * @throws if `maxMs` is not finite, for `advance`'s reason: an infinite budget
 * is a guard that never bites and a `NaN` one fails every comparison, so both
 * restore exactly the hang the budget exists to remove.
 */
export function runUntil(
  state: GameState,
  predicate: (candidate: GameState) => boolean,
  maxMs: number,
): { state: GameState; elapsedMs: number } {
  if (!Number.isFinite(maxMs)) {
    throw new Error(
      `runUntil: maxMs must be a finite number, received ${String(maxMs)}. ` +
        'An infinite budget never bites and a NaN one fails every comparison, so ' +
        'either turns this call back into the hang the guard exists to prevent.',
    );
  }

  let current = state;
  let elapsedMs = 0;

  while (!predicate(current)) {
    if (elapsedMs + CONFIG.TICK_MS > maxMs) {
      throw new Error(
        `runUntil: the predicate did not hold within the ${maxMs}ms budget ` +
          `(${elapsedMs / CONFIG.TICK_MS} ticks of ${CONFIG.TICK_MS}ms, ` +
          `${elapsedMs}ms simulated; one more would pass the budget). ` +
          'Either the budget is too small or the engine stopped advancing; the ' +
          'guard exists so that the second case fails rather than hangs.',
      );
    }
    current = tick(current, CONFIG.TICK_MS);
    elapsedMs += CONFIG.TICK_MS;
  }

  return { state: current, elapsedMs };
}

/**
 * The stand-in for a property that is present and explicitly `undefined`.
 * `JSON.stringify` drops such a property entirely, which would make an
 * accidental `undefined` indistinguishable from an absent field — one of the
 * masks `expectSameState` exists to remove.
 *
 * This and the `<NaN>` / `<Infinity>` / `<-0>` markers are ordinary strings, so
 * a *string-valued* field holding that same literal text would be conflated with
 * a real `undefined` or `NaN`. Unreachable today — every string-typed
 * `GameState` field is a closed enum union, none of whose members is
 * angle-bracketed — and worth revisiting the day `GameState` gains a free-form
 * string, at which point the markers need something unforgeable in them.
 */
const UNDEFINED_MARKER = '<undefined>';

/**
 * The stand-in for negative zero, which `JSON.stringify` writes as `0`.
 *
 * Without it `expectSameState` would be *weaker* than `toEqual` on this one
 * axis, which would undercut the module's whole reason for existing: the public
 * entry point compares canonical serialisations and returns early when they
 * match, so a `-0`/`0` pair would never reach the `Object.is` walk that does
 * tell them apart. `-0` is reachable in a `GameState` the moment engine
 * arithmetic rounds a small negative — `Math.round(-0.4)` is `-0` — so this is a
 * real mask rather than a theoretical one.
 */
const NEGATIVE_ZERO_MARKER = '<-0>';

/**
 * `Array.isArray` narrows `unknown` to `any[]`, which puts `any` into every
 * expression downstream of it. This guard says `readonly unknown[]` instead, so
 * the walk below stays typed.
 */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** True for a non-null object that is not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isList(value);
}

/**
 * The `JSON.stringify` replacer that makes the serialisation canonical.
 *
 * Four normalisations, each closing a way two different states could otherwise
 * stringify the same:
 *
 * - object keys are emitted in sorted order, so insertion order cannot matter;
 * - an `undefined` value becomes a marker rather than vanishing;
 * - `NaN` and the infinities become markers rather than all collapsing to
 *   `null`, which would make a `NaN` `nextArrivalMs` look like a null one;
 * - `-0` becomes a marker rather than being written as `0`, so the serialisation
 *   is at least as discriminating as `toEqual` on every axis and the `Object.is`
 *   walk below is not contradicted by the fast path that precedes it.
 *
 * Applied recursively by `JSON.stringify` itself: returning a shallow key-sorted
 * copy is enough, because the replacer is invoked again for every property of
 * whatever it returns.
 */
function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return UNDEFINED_MARKER;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return NEGATIVE_ZERO_MARKER;
    return Number.isFinite(value) ? value : `<${String(value)}>`;
  }
  if (!isRecord(value)) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

/**
 * A state as a canonical string: recursively key-sorted, with `undefined` and
 * the non-finite numbers made visible.
 *
 * Exported because "the call did not mutate its input" is asserted by capturing
 * this before the call and comparing afterwards, and a test cannot capture what
 * it cannot name.
 *
 * The fallback is not dead code, even though TypeScript types this call as
 * returning `string`: `JSON.stringify` genuinely returns `undefined` for a root
 * that serialises to nothing — a function or a symbol, both of which
 * `canonicalReplacer` passes through untouched. Unreachable for a `GameState`,
 * but the parameter is `unknown` and the function is exported, so the declared
 * `string` should not be a lie for the first caller who points it elsewhere.
 */
export function canonicalise(state: unknown): string {
  return JSON.stringify(state, canonicalReplacer) ?? `<${typeof state}>`;
}

/** The first place two values differ, in `queue[1].patienceMs` notation. */
interface Difference {
  path: string;
  actual: unknown;
  expected: unknown;
}

/** `'<root>'` for the whole state, so a message never names an empty path. */
function labelFor(path: string): string {
  return path === '' ? '<root>' : path;
}

/**
 * The first differing path, walking both values in parallel in the same sorted
 * key order the serialisation uses — so the reported path is stable rather than
 * a function of whichever key happened to be declared first.
 *
 * Returns `null` when the two agree. Descends through arrays by index and
 * objects by key; anything else is compared with `Object.is`, which is what
 * makes `NaN` equal to itself and `0` distinguishable from `-0`. That second
 * property is only observable through `expectSameState` because
 * `canonicalReplacer` gives `-0` its own marker: the public entry point compares
 * serialisations first and returns early on a match, so a mask closed here and
 * left open there would never be reached.
 *
 * A container whose children all agree returns `null` even though the two
 * references differ — `Object.is` is a fast path for identity, not the
 * definition of equality here. Reporting the container instead would name
 * `frameEvents` on every comparison of two states that each carry their own
 * empty array, which is every comparison there is.
 */
function differenceBetween(actual: unknown, expected: unknown, path: string): Difference | null {
  if (Object.is(actual, expected)) return null;

  if (isList(actual) && isList(expected)) {
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index += 1) {
      const inner = differenceBetween(actual[index], expected[index], `${path}[${index}]`);
      if (inner !== null) return inner;
    }
    return null;
  }

  if (isRecord(actual) && isRecord(expected)) {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
    for (const key of keys) {
      const child = path === '' ? key : `${path}.${key}`;
      const inner = differenceBetween(actual[key], expected[key], child);
      if (inner !== null) return inner;
    }
    return null;
  }

  return { path: labelFor(path), actual, expected };
}

/**
 * Assert two states are identical, comparing canonical serialisations rather
 * than object graphs.
 *
 * A plain `Error` rather than a Vitest matcher, so this module keeps §10.5's
 * import boundary — it names nothing outside `src/game/` — and so it is usable
 * from a plain assertion, a property test or a fixture regenerator alike. Vitest
 * reports a thrown error as a failure exactly as it reports a failed matcher.
 *
 * @throws when the states differ, with a message naming the first differing
 * path — `queue[1].patienceMs`, not "objects are not equal" — because the path
 * is the only part of the failure that says which rule broke.
 */
export function expectSameState(actual: GameState, expected: GameState): void {
  const actualText = canonicalise(actual);
  const expectedText = canonicalise(expected);
  if (actualText === expectedText) return;

  const difference = differenceBetween(actual, expected, '');
  // Reachable, and the case worth having: a property that is *present and
  // `undefined`* on one side and absent on the other serialises differently —
  // that is the whole point of `UNDEFINED_MARKER` — while the parallel walk
  // reads `undefined` on both sides and finds nothing. There is no single path
  // to name, so both serialisations are shown instead.
  if (difference === null) {
    throw new Error(
      'expectSameState: states serialise differently but compare structurally equal.\n' +
        `  actual:   ${actualText}\n  expected: ${expectedText}`,
    );
  }

  throw new Error(
    `expectSameState: states differ at ${difference.path}\n` +
      `  actual:   ${canonicalise(difference.actual)}\n` +
      `  expected: ${canonicalise(difference.expected)}`,
  );
}
