/**
 * S3-4 — `src/game/engine.ts`, part 3 of §10.5's three-part seam: the three
 * signatures, committed and typechecked now so that M1a fills bodies rather than
 * negotiating shapes.
 *
 * The bodies throw. That is the point: a stub that returned a plausible
 * `GameState` could be mistaken for a working engine and would let a Track A
 * story ship against a fiction. Throwing with `NotImplemented` and the story ID
 * that owns the body makes the stub self-describing at the moment it is misused.
 *
 * These assertions also keep `engine.ts` at 100% line coverage under §10.7's
 * `perFile` threshold from this sprint onward, so Sprint 8 can turn the
 * threshold on over real files rather than an empty directory.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, expectTypeOf } from 'vitest';
import { CONFIG } from '../../src/game/config';
import * as engine from '../../src/game/engine';
import { applyAction, createInitialState, tick } from '../../src/game/engine';
import type { Action, GameState, Mode } from '../../src/game/types';

const SOURCE = readFileSync(new URL('../../src/game/engine.ts', import.meta.url), 'utf8');

/**
 * A `GameState`-shaped argument for the signature assertions.
 *
 * Nothing reads it — every call below throws before touching it — but it is
 * built as a real `GameState` rather than a cast so that a field added to
 * §10.3's interface fails typecheck here too.
 */
const STATE: GameState = {
  phase: 'playing',
  mode: 'endless',
  queue: [],
  activeId: null,
  builder: {
    base: 'kopi',
    milk: 'condensed',
    sugar: 'normal',
    strength: 'normal',
    temperature: 'hot',
    vessel: 'cup',
  },
  // §10.4: a fixture reads its numbers from config rather than restating them.
  hearts: CONFIG.HEARTS,
  comboTenths: CONFIG.COMBO_MIN_TENTHS,
  bestComboTenths: CONFIG.COMBO_MIN_TENTHS,
  score: 0,
  shiftIndex: 0,
  spawnedInShift: 0,
  servedInShift: 0,
  walkoutsInShift: 0,
  servesAttempted: 0,
  servesCorrect: 0,
  lockoutMs: 0,
  nextArrivalMs: 0,
  nextCustomerId: 1,
  rngState: 1,
  tickRemainderMs: 0,
  shiftResults: [],
  frameEvents: [],
};

describe('§10.5 — the three signatures, and only those three', () => {
  it('exports exactly createInitialState, tick and applyAction', () => {
    expect(Object.keys(engine).sort()).toEqual(['applyAction', 'createInitialState', 'tick']);
  });

  it('types them exactly as §10.3 declares them', () => {
    expectTypeOf(createInitialState).toEqualTypeOf<(mode: Mode, seed: number) => GameState>();
    expectTypeOf(tick).toEqualTypeOf<(state: GameState, dtMs: number) => GameState>();
    expectTypeOf(applyAction).toEqualTypeOf<(state: GameState, action: Action) => GameState>();
  });

  it('names §10.3’s parameters verbatim, so the contract reads off the source', () => {
    expect(SOURCE).toContain('createInitialState(mode: Mode, seed: number): GameState');
    expect(SOURCE).toContain('tick(state: GameState, dtMs: number): GameState');
    expect(SOURCE).toContain('applyAction(state: GameState, action: Action): GameState');
  });

  it('imports only the type surface — no config, no view, no React, no DOM', () => {
    const specifiers = [...SOURCE.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers).toEqual(['./types']);
  });
});

/**
 * Consumed the way §10.5 says the one indirection consumes it: the three
 * signatures behind a `{ state, dispatch }` shape.
 *
 * `src/app/EngineContext.tsx` is Sprint 13's file and does not exist yet, so
 * S3-4's last criterion — "typecheck is green with the signatures referenced
 * from EngineContext" — is met here instead, from a consumer that reproduces the
 * calls that module will make. This is not a stand-in that retires: the property
 * it asserts, that the three signatures compose into a reducer plus a clock, has
 * to hold for the life of the project.
 */
describe('§10.5 — the signatures compose into the shape EngineContext needs', () => {
  it('typechecks as a reducer over Action seeded by createInitialState', () => {
    const reducer: (state: GameState, action: Action) => GameState = applyAction;
    const clock: (state: GameState, dtMs: number) => GameState = tick;
    const bootstrap: (mode: Mode, seed: number) => GameState = createInitialState;

    expect(reducer).toBe(applyAction);
    expect(clock).toBe(tick);
    expect(bootstrap).toBe(createInitialState);
  });

  it('accepts every one of §10.3’s seven Action variants', () => {
    const actions: Action[] = [
      { type: 'START_RUN', mode: 'daily', seed: 1 },
      { type: 'FOCUS', customerId: 1 },
      { type: 'SET_SLOT', slot: 'sugar', value: 'ga-dai' },
      { type: 'SET_SLOT', slot: 'vessel', value: 'bag' },
      { type: 'SERVE' },
      { type: 'DISMISS_BREAK' },
      { type: 'PAUSE' },
      { type: 'RESUME' },
    ];

    for (const action of actions) {
      expect(() => applyAction(STATE, action)).toThrow(/NotImplemented/);
    }
    // Seven discriminants across eight actions — SET_SLOT appears twice.
    expect(new Set(actions.map((action) => action.type)).size).toBe(7);
  });
});

describe('the stub cannot be mistaken for a working engine', () => {
  it('createInitialState throws NotImplemented for both modes', () => {
    for (const mode of ['endless', 'daily'] as const) {
      expect(() => createInitialState(mode, 1)).toThrow(/NotImplemented/);
    }
  });

  it('tick throws NotImplemented, including for a zero delta', () => {
    expect(() => tick(STATE, 0)).toThrow(/NotImplemented/);
    expect(() => tick(STATE, 1)).toThrow(/NotImplemented/);
  });

  it('applyAction throws NotImplemented', () => {
    expect(() => applyAction(STATE, { type: 'SERVE' })).toThrow(/NotImplemented/);
  });

  it('names the M1a story that will implement each body', () => {
    // A `NotImplemented` with no owner is a dead end for whoever hits it.
    expect(() => createInitialState('endless', 1)).toThrow(/S21-2/);
    expect(() => tick(STATE, CONFIG.TICK_MS)).toThrow(/S21-1/);
    expect(() => applyAction(STATE, { type: 'PAUSE' })).toThrow(/S21-2/);
  });

  it('throws an Error, not a string or a plain object', () => {
    for (const call of [
      (): GameState => createInitialState('endless', 1),
      (): GameState => tick(STATE, 1),
      (): GameState => applyAction(STATE, { type: 'SERVE' }),
    ]) {
      expect(call).toThrow(Error);
      let caught: unknown;
      try {
        call();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      // Narrowed rather than cast: an `unknown` that is not an `Error` must fail
      // the assertion above rather than be asserted into one here.
      if (!(caught instanceof Error)) throw new Error('unreachable: asserted above');
      expect(caught.message).toMatch(/NotImplemented/);
      expect(caught.name).toBe('Error');
    }
  });

  it('holds no §10.3 engine behaviour yet — nothing to mistake for an engine', () => {
    // No Date.now, no timers, no bare Math.random: §10.3's purity ban applies to
    // the stub too, and Sprint 7's lint rule must be green over this file.
    for (const banned of ['Date.now', 'performance.now', 'Math.random', 'setTimeout']) {
      expect(SOURCE, banned).not.toContain(banned);
    }
  });
});
