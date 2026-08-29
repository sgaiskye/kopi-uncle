/**
 * S10-1 — the fold harness, tested.
 *
 * **Why the engine is substituted here.** `src/game/engine.ts` is Sprint 3's
 * frozen signature and every one of its three bodies still throws until S21-1
 * and S21-2 fill them. What this file is about is the harness — dispatch order,
 * the `MAX_FRAME_MS` chunking, the loop guard and the canonical comparison —
 * none of which is a claim about the engine's rules. So the module is replaced
 * with a reducer that implements exactly the one engine behaviour the harness
 * depends on: R20's quantisation, where `dtMs` accumulates into
 * `tickRemainderMs` and whole `TICK_MS` steps are applied with the remainder
 * carried. That carry is the reason `advance` may chunk at all, so a double
 * without it would make the chunking-invariance assertion vacuous.
 *
 * The double reads `TICK_MS` from `src/game/config.ts` for the same §10.4 reason
 * the harness does.
 *
 * **No §8.5 millisecond value appears below.** `tests/contract/config.test.ts`'s
 * single-source scan covers `tests/support/**`, so every duration here is either
 * derived from `CONFIG` or a value §8.5 does not use — which is also why the
 * five-second chunking case is written as a multiple of `MAX_FRAME_MS` rather
 * than as digits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../../src/game/config';
import type { Customer, Drink, GameState } from '../../src/game/types';
import { advance, canonicalise, expectSameState, fold, runUntil } from './harness';
import type { Step } from './harness';

/**
 * Every `dtMs` the harness handed to `tick`, in order. This is how the chunking
 * criterion is asserted on behaviour rather than on the harness's source text.
 */
const recorder = vi.hoisted(() => ({ tickDts: [] as number[] }));

vi.mock('../../src/game/engine', async () => {
  const { CONFIG: config } = await import('../../src/game/config');
  const { setSlot } = await import('../../src/game/types');
  type State = import('../../src/game/types').GameState;
  type Act = import('../../src/game/types').Action;

  /**
   * R20 in miniature: quantise, carry the remainder, and drain every queued
   * customer by the whole milliseconds actually applied. `score` counts applied
   * steps so that "how much time was really consumed" is observable as a single
   * integer.
   *
   * §10.3's identity clause is honoured — the same reference comes back when
   * `phase !== 'playing'` or `dtMs === 0` — because the harness's `PAUSE`
   * ordering test is about exactly that.
   */
  function tick(state: State, dtMs: number): State {
    recorder.tickDts.push(dtMs);
    if (state.phase !== 'playing' || dtMs === 0) return state;

    const carried = state.tickRemainderMs + dtMs;
    const wholeSteps = Math.floor(carried / config.TICK_MS);
    const tickRemainderMs = carried - wholeSteps * config.TICK_MS;
    const drained = wholeSteps * config.TICK_MS;

    return {
      ...state,
      tickRemainderMs,
      score: state.score + wholeSteps,
      nextArrivalMs: state.nextArrivalMs - drained,
      queue: state.queue.map((customer) => ({
        ...customer,
        patienceMs: customer.patienceMs - drained,
      })),
      frameEvents: [],
    };
  }

  function applyAction(state: State, action: Act): State {
    switch (action.type) {
      case 'START_RUN':
        return { ...state, phase: 'playing', mode: action.mode, rngState: action.seed };
      case 'FOCUS':
        return { ...state, activeId: action.customerId };
      case 'SET_SLOT':
        return { ...state, builder: setSlot(state.builder, action.slot, action.value) };
      case 'SERVE':
        return {
          ...state,
          servesAttempted: state.servesAttempted + 1,
          queue: state.queue.slice(1),
        };
      case 'DISMISS_BREAK':
        return { ...state, phase: 'playing' };
      case 'PAUSE':
        return { ...state, phase: 'paused' };
      case 'RESUME':
        return { ...state, phase: 'playing' };
    }
  }

  function createInitialState(): State {
    throw new Error('createInitialState is not part of what the fold harness is tested against.');
  }

  return { tick, applyAction, createInitialState };
});

const ORDER: Drink = {
  base: 'kopi',
  milk: 'condensed',
  sugar: 'normal',
  strength: 'normal',
  temperature: 'hot',
  vessel: 'cup',
};

function customer(id: number, patienceMs: number): Customer {
  return { id, order: ORDER, maxPatienceMs: 9000, patienceMs, fumbled: false };
}

/**
 * A plausible mid-shift state. None of these numbers is a §8.5 value — the
 * harness has no opinion about the difficulty curve, and borrowing one here
 * would trip §10.4's single-source scan.
 */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    mode: 'endless',
    queue: [customer(1, 9000), customer(2, 8500), customer(3, 7000)],
    activeId: 1,
    builder: ORDER,
    hearts: 3,
    comboTenths: 10,
    bestComboTenths: 10,
    score: 0,
    shiftIndex: 0,
    spawnedInShift: 3,
    servedInShift: 0,
    walkoutsInShift: 0,
    servesAttempted: 0,
    servesCorrect: 0,
    lockoutMs: 0,
    nextArrivalMs: 1500,
    nextCustomerId: 4,
    rngState: 987654321,
    tickRemainderMs: 0,
    shiftResults: [[]],
    frameEvents: [],
    ...overrides,
  };
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isList(value);
}

/**
 * The same object graph with every object's keys inserted in the opposite
 * order. Structurally identical, byte-for-byte different under a naive
 * `JSON.stringify` — which is what makes it the right probe for the canonical
 * replacer.
 */
function reverseKeyOrder(value: unknown): unknown {
  if (isList(value)) return value.map(reverseKeyOrder);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) {
    out[key] = reverseKeyOrder(value[key]);
  }
  return out;
}

const HARNESS_PATH = fileURLToPath(new URL('./harness.ts', import.meta.url));
const HARNESS_SOURCE = readFileSync(HARNESS_PATH, 'utf8');

/**
 * Every module specifier a source names, across all five forms that can put a
 * dependency into the module graph: `import … from 'x'`, `export … from 'x'`,
 * the side-effect `import 'x'`, the dynamic `import('x')` and `require('x')`.
 *
 * A bare `from`-clause scan sees only the first two, which makes "imports only
 * from `src/game/`" blind to exactly the import a boundary is most likely to be
 * broken with — a side-effect import of a hand-written fixture, which has no
 * `from` clause and binds no name.
 *
 * `tests/contract/source.ts` already solves this properly, over a lexer that
 * strips comments first. It is deliberately not imported: Sprint 3.1 owns that
 * tree and this sprint's declared scope is `tests/support/**`, so a dependency
 * edge from here into a directory another sprint is actively editing would be
 * bought for a test that has a cheaper backstop available. That backstop is the
 * assertion below that the harness contains no `import(` or `require(` at all —
 * which is what the lexer would otherwise be needed for, since a runtime-built
 * specifier is invisible to any amount of scanning.
 */
function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]);
}

/** Every module specifier the harness names. */
const SPECIFIERS = importSpecifiers(HARNESS_SOURCE);

beforeEach(() => {
  recorder.tickDts.length = 0;
});

describe('S10-1 the harness surface', () => {
  it('exports the four primitives the sprint names', () => {
    expect(typeof fold).toBe('function');
    expect(typeof advance).toBe('function');
    expect(typeof runUntil).toBe('function');
    expect(typeof expectSameState).toBe('function');
  });

  it('types a Step as either a tick or any Action', () => {
    // Compile-time coverage of `Step = { tick: number } | Action`: this array
    // only typechecks if both arms are assignable.
    const steps: Step[] = [
      { tick: CONFIG.TICK_MS },
      { type: 'START_RUN', mode: 'daily', seed: 7 },
      { type: 'FOCUS', customerId: 1 },
      { type: 'SET_SLOT', slot: 'sugar', value: 'kosong' },
      { type: 'SERVE' },
      { type: 'DISMISS_BREAK' },
      { type: 'PAUSE' },
      { type: 'RESUME' },
    ];
    expect(steps).toHaveLength(8);
  });
});

describe('S10-1 fold', () => {
  it('dispatches a tick step through tick and every other step through applyAction', () => {
    const start = makeState();
    const twoTicks = 2 * CONFIG.TICK_MS;

    const result = fold(start, [
      { tick: twoTicks },
      { type: 'SET_SLOT', slot: 'base', value: 'teh' },
    ]);

    // The tick went to `tick`: two whole steps applied, patience drained.
    expect(recorder.tickDts).toEqual([twoTicks]);
    expect(result.score).toBe(2);
    expect(result.queue[0].patienceMs).toBe(9000 - twoTicks);
    // The action went to `applyAction`.
    expect(result.builder.base).toBe('teh');
  });

  it('applies steps in array order, so reordering changes the result', () => {
    const start = makeState();
    const window = 4 * CONFIG.TICK_MS;

    const pauseFirst = fold(start, [{ type: 'PAUSE' }, { tick: window }]);
    const tickFirst = fold(start, [{ tick: window }, { type: 'PAUSE' }]);

    expect(pauseFirst.score).toBe(0);
    expect(tickFirst.score).toBe(4);
    expect(pauseFirst.phase).toBe('paused');
    expect(tickFirst.phase).toBe('paused');
    expect(() => {
      expectSameState(pauseFirst, tickFirst);
    }).toThrow(/states differ at /);
  });

  it('does not mutate the state it is given', () => {
    const start = makeState();
    const before = canonicalise(start);

    fold(start, [
      { tick: 10 * CONFIG.TICK_MS },
      { type: 'SERVE' },
      { type: 'FOCUS', customerId: 2 },
      { tick: 10 * CONFIG.TICK_MS },
    ]);

    expect(canonicalise(start)).toBe(before);
  });

  it('returns the input state for an empty step list', () => {
    const start = makeState();
    expect(fold(start, [])).toBe(start);
  });
});

describe('S10-1 advance', () => {
  // Five seconds, written as the twenty maximum-length frames it is. The digits
  // are deliberately absent: §10.4's scan covers this directory.
  const FIVE_SECONDS = 20 * CONFIG.MAX_FRAME_MS;

  it('slices into chunks of at most MAX_FRAME_MS', () => {
    advance(makeState(), FIVE_SECONDS);

    expect(recorder.tickDts).toHaveLength(20);
    expect(Math.max(...recorder.tickDts)).toBe(CONFIG.MAX_FRAME_MS);
    expect(recorder.tickDts.reduce((sum, dt) => sum + dt, 0)).toBe(FIVE_SECONDS);
  });

  it('carries a short final chunk rather than overshooting the budget', () => {
    const total = 2 * CONFIG.MAX_FRAME_MS + 60;
    advance(makeState(), total);

    expect(recorder.tickDts).toEqual([CONFIG.MAX_FRAME_MS, CONFIG.MAX_FRAME_MS, 60]);
  });

  it('chunking is invariant: advance equals one tick of the same length', () => {
    const start = makeState();

    expectSameState(advance(start, FIVE_SECONDS), fold(start, [{ tick: FIVE_SECONDS }]));
  });

  it('chunking is invariant from a non-zero tickRemainderMs too', () => {
    const start = makeState({ tickRemainderMs: CONFIG.TICK_MS - 1 });

    expectSameState(advance(start, FIVE_SECONDS), fold(start, [{ tick: FIVE_SECONDS }]));
  });

  it('reads MAX_FRAME_MS from config rather than writing the number', () => {
    expect(HARNESS_SOURCE).toContain('CONFIG.MAX_FRAME_MS');
    expect(HARNESS_SOURCE).not.toMatch(
      new RegExp(`(?<![\\w.])${String(CONFIG.MAX_FRAME_MS)}(?![\\w.])`),
    );
  });

  it('advances no time at all for a zero or negative total', () => {
    const start = makeState();

    expect(advance(start, 0)).toBe(start);
    expect(advance(start, -1)).toBe(start);
    expect(recorder.tickDts).toEqual([]);
  });

  it(
    'refuses a non-finite total instead of spinning or silently doing nothing',
    { timeout: 1000 },
    () => {
      const start = makeState();

      // `Infinity - MAX_FRAME_MS` is `Infinity`, so `remaining` never decreases
      // and the chunk list grows until the process dies. There is no assertion
      // to make about a call that never returns, so the throw is the test — and
      // the declared timeout is what turns a regression into a red run rather
      // than a hung one.
      expect(() => advance(start, Number.POSITIVE_INFINITY)).toThrow(/finite/);
      expect(() => advance(start, Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
      expect(() => advance(start, Number.NEGATIVE_INFINITY)).toThrow(/finite/);

      // The quieter half: `NaN > 0` is false, so the loop body never runs and a
      // caller who asked for a nonsense duration is told nothing at all.
      expect(() => advance(start, Number.NaN)).toThrow(/finite/);
      expect(() => advance(start, Number.NaN)).toThrow(/NaN/);

      // Rejected before any dispatch, not part-way through one.
      expect(recorder.tickDts).toEqual([]);
    },
  );

  it('does not mutate the state it is given', () => {
    const start = makeState();
    const before = canonicalise(start);

    advance(start, FIVE_SECONDS);

    expect(canonicalise(start)).toBe(before);
  });
});

describe('S10-1 runUntil', () => {
  it('advances in TICK_MS increments and reports a whole number of ticks', () => {
    const start = makeState();

    const { state, elapsedMs } = runUntil(start, (candidate) => candidate.score >= 10, 1000);

    expect(recorder.tickDts.every((dt) => dt === CONFIG.TICK_MS)).toBe(true);
    expect(elapsedMs % CONFIG.TICK_MS).toBe(0);
    expect(elapsedMs).toBe(10 * CONFIG.TICK_MS);
    expect(state.score).toBe(10);
  });

  it('returns a state that satisfies the predicate, at the first tick it holds', () => {
    const start = makeState();
    const target = start.queue[0].patienceMs - 7 * CONFIG.TICK_MS;

    const { state, elapsedMs } = runUntil(start, (c) => c.queue[0].patienceMs <= target, 1000);

    expect(state.queue[0].patienceMs).toBe(target);
    expect(elapsedMs).toBe(7 * CONFIG.TICK_MS);
  });

  it('costs zero milliseconds when the predicate already holds', () => {
    const start = makeState();

    const { state, elapsedMs } = runUntil(start, () => true, 1000);

    expect(elapsedMs).toBe(0);
    expect(elapsedMs % CONFIG.TICK_MS).toBe(0);
    expect(state).toBe(start);
    expect(recorder.tickDts).toEqual([]);
  });

  it(
    'the loop guard bites: a predicate that never holds throws, naming the budget',
    { timeout: 1000 },
    () => {
      // Twenty seconds of simulated time — 1250 ticks — which the guard has to
      // reach and give up on well inside this test's own 1000ms wall clock.
      const budgetMs = 20 * 1000;

      let thrown: unknown;
      try {
        runUntil(makeState(), () => false, budgetMs);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(String(budgetMs));
      expect(recorder.tickDts).toHaveLength(budgetMs / CONFIG.TICK_MS);
    },
  );

  it('stops at the last whole tick inside a budget that is off the tick grid', () => {
    const start = makeState();
    // The shape a wall-clock budget actually has: `TICK_MS` does not divide it.
    // Four of the call sites above pass 1000ms, which is exactly this case.
    const wholeTicks = 5;
    const offGrid = wholeTicks * CONFIG.TICK_MS + 1;

    const { elapsedMs } = runUntil(start, (c) => c.score >= wholeTicks, offGrid);

    expect(elapsedMs).toBe(wholeTicks * CONFIG.TICK_MS);
    expect(elapsedMs).toBeLessThanOrEqual(offGrid);
  });

  it('gives up rather than taking the tick that would carry it past the budget', () => {
    const start = makeState();
    const wholeTicks = 5;
    const offGrid = wholeTicks * CONFIG.TICK_MS + 1;

    let thrown: unknown;
    try {
      // One tick more than the budget affords.
      runUntil(start, (c) => c.score > wholeTicks, offGrid);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(`${offGrid}ms budget`);

    // The point of the fix: the tick count the message quotes must not total
    // more than the budget quoted beside it, or the message contradicts itself
    // in precisely the situation it exists to explain.
    const quoted = Number(/\((\d+) ticks/.exec(message)?.[1]);
    expect(quoted).toBe(wholeTicks);
    expect(quoted * CONFIG.TICK_MS).toBeLessThanOrEqual(offGrid);
    expect(recorder.tickDts).toHaveLength(wholeTicks);
  });

  it('refuses a non-finite budget, which is a guard that never bites', () => {
    // `elapsedMs + TICK_MS > Infinity` is never true and every comparison with
    // `NaN` is false, so either value turns the budget back into the hang it
    // exists to prevent. Rejected at entry, before a single tick.
    expect(() => runUntil(makeState(), () => false, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => runUntil(makeState(), () => false, Number.NaN)).toThrow(/finite/);
    expect(recorder.tickDts).toEqual([]);
  });

  it('does not mutate the state it is given', () => {
    const start = makeState();
    const before = canonicalise(start);

    runUntil(start, (candidate) => candidate.score >= 5, 1000);

    expect(canonicalise(start)).toBe(before);
  });
});

describe('S10-1 expectSameState', () => {
  it('compares equal across a different key insertion order', () => {
    const original = makeState();
    const reordered = reverseKeyOrder(original) as GameState;

    // The probe only means something if the orders really do differ.
    expect(Object.keys(reordered).join(',')).not.toBe(Object.keys(original).join(','));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(original));

    expect(() => {
      expectSameState(original, reordered);
    }).not.toThrow();
  });

  it('sorts keys recursively, not only at the root', () => {
    const hotFirst = { temperature: 'hot', vessel: 'cup' };
    const vesselFirst = { vessel: 'cup', temperature: 'hot' };

    expect(canonicalise({ builder: hotFirst })).toBe(canonicalise({ builder: vesselFirst }));
    expect(JSON.stringify({ builder: hotFirst })).not.toBe(
      JSON.stringify({ builder: vesselFirst }),
    );
  });

  it('names the differing path when one nested field differs', () => {
    const left = makeState();
    const right = makeState({
      queue: [customer(1, 9000), customer(2, 8500 - CONFIG.TICK_MS), customer(3, 7000)],
    });

    expect(() => {
      expectSameState(left, right);
    }).toThrow(/queue\[1\]\.patienceMs/);
  });

  it('names an array index when the queue lengths differ', () => {
    const left = makeState();
    const right = makeState({ queue: [customer(1, 9000), customer(2, 8500)] });

    expect(() => {
      expectSameState(left, right);
    }).toThrow(/queue\[2\]/);
  });

  it('does not throw for two independently built identical states', () => {
    expect(() => {
      expectSameState(makeState(), makeState());
    }).not.toThrow();
  });

  it('an explicit undefined is distinguishable from an absent field', () => {
    expect(canonicalise({ a: 1, b: undefined })).not.toBe(canonicalise({ a: 1 }));
  });

  it('reports the two serialisations when only field *presence* differs', () => {
    // `toEqual` calls these two equal, which is the second mask §10.7's
    // determinism check cannot afford. There is no differing *value* to name a
    // path for, so the failure shows both canonical strings instead.
    const present = { ...makeState(), activeId: undefined } as unknown as GameState;
    const absent = { ...makeState() };
    delete (absent as Partial<GameState>).activeId;

    expect(() => {
      expectSameState(present, absent);
    }).toThrow(/serialise differently but compare structurally equal/);
  });

  it('distinguishes -0 from 0, where a naive stringify cannot', () => {
    // The probe: this is the mask, and it is one `toEqual` does *not* have. A
    // comparison that claims to be stricter than `toEqual` cannot be looser here.
    expect(JSON.stringify({ nextArrivalMs: -0 })).toBe(JSON.stringify({ nextArrivalMs: 0 }));

    expect(canonicalise({ nextArrivalMs: -0 })).not.toBe(canonicalise({ nextArrivalMs: 0 }));

    // And it reaches `expectSameState`, whose serialisation fast path is what
    // would otherwise return early and never consult the `Object.is` walk.
    expect(() => {
      expectSameState(makeState({ nextArrivalMs: -0 }), makeState({ nextArrivalMs: 0 }));
    }).toThrow(/nextArrivalMs/);
  });

  it('a non-finite number is distinguishable from null', () => {
    expect(canonicalise({ nextArrivalMs: Number.NaN })).not.toBe(
      canonicalise({ nextArrivalMs: null }),
    );
    expect(canonicalise({ nextArrivalMs: Number.POSITIVE_INFINITY })).not.toBe(
      canonicalise({ nextArrivalMs: Number.NEGATIVE_INFINITY }),
    );
  });
});

describe('S10-1 the harness import boundary', () => {
  it('finds the imports it is about to check, so it cannot pass vacuously', () => {
    expect(SPECIFIERS.length).toBeGreaterThan(0);
    expect(SPECIFIERS).toContain('../../src/game/config');
    expect(SPECIFIERS).toContain('../../src/game/engine');
  });

  it('sees the import forms a from-clause alone would miss', () => {
    // The probe for `importSpecifiers` itself: a `from`-clause scan reports the
    // first two of these and silently ignores the last three, so a side-effect
    // import of a hand-written fixture would pass the boundary check below
    // without ever being looked at.
    const probe = [
      "import { a } from './from-clause';",
      "export { b } from './re-export';",
      "import './side-effect';",
      "const c = await import('./dynamic');",
      "const d = require('./commonjs');",
    ].join('\n');

    expect(importSpecifiers(probe).sort()).toEqual([
      './commonjs',
      './dynamic',
      './from-clause',
      './re-export',
      './side-effect',
    ]);
  });

  it('imports only from src/game/', () => {
    expect(SPECIFIERS.filter((s) => !s.startsWith('../../src/game/'))).toEqual([]);
  });

  it('reaches for nothing at runtime, so no specifier can escape the scan', () => {
    // A specifier assembled at runtime — `import(base + name)` — is invisible to
    // any text scan, including `tests/contract/source.ts`'s lexer. What is not
    // invisible is the syntax that would evaluate one, and the harness has no
    // business holding either form.
    expect(HARNESS_SOURCE).not.toMatch(/\bimport\s*\(/);
    expect(HARNESS_SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it('names no module under the presentation, graphics or dev trees', () => {
    for (const forbidden of ['src/components/', 'src/graphics/', 'src/dev/']) {
      expect(HARNESS_SOURCE).not.toContain(forbidden);
    }
  });
});
