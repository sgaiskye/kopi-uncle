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
import { importSpecifiers, stripComments, stripCommentsAndStrings } from './source';

const SOURCE = readFileSync(new URL('../../src/game/engine.ts', import.meta.url), 'utf8');

/**
 * The ambient sources of state §10.3 puts out of reach of the engine, named once
 * so the check and its negative control cannot drift apart.
 */
const BANNED_IMPURITIES = ['Date.now', 'performance.now', 'Math.random', 'setTimeout'];

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

  /**
   * A denylist, for the same reason `view.test.ts` uses one: S3-4 asks for the
   * engine to be free of React and the DOM, not for its import list to be frozen
   * at today's set. Sprint 21 must add `./config` the moment §10.4 forbids it
   * from restating a §8 number, and `./generator` when §7.5 puts `generateOrder`
   * there — and `tests/contract/**` is Sprint 3's, not Sprint 21's. The purity
   * check further down this file is the model: a rule §10.3 makes permanent.
   */
  it('imports only from src/game — no React, no DOM', () => {
    const specifiers = importSpecifiers(SOURCE);
    expect(specifiers).toContain('./types');
    for (const specifier of specifiers) {
      expect(specifier, specifier).toMatch(/^\.\/[a-z][a-z0-9-]*$/);
    }
    for (const banned of ['react', 'react-dom']) {
      expect(specifiers, banned).not.toContain(banned);
    }
    // Read over code with comments *and string literals* stripped: a
    // `document` inside a string is not a DOM access, and the file this reads
    // is one Sprint 21 rewrites without owning this test.
    const code = stripCommentsAndStrings(SOURCE);
    for (const global of ['document', 'window', 'navigator', 'localStorage']) {
      expect(code, global).not.toMatch(new RegExp(`\\b${global}\\b`));
    }
  });

  it('reads the DOM denylist from code, and only from code', () => {
    // Both halves of the control for the line above. Stripping strings as well
    // as comments must not have turned the check off — an access written in
    // code is still found — and it must have turned off exactly the false
    // positive it was meant to: a global named inside a string literal or a
    // comment is prose about the DOM, not the DOM. Probed on synthetic sources,
    // because the real file is required to contain neither shape.
    for (const global of ['document', 'window', 'navigator', 'localStorage']) {
      const bites = stripCommentsAndStrings(`const has = typeof ${global} !== 'x';\n`);
      expect(bites, global).toMatch(new RegExp(`\\b${global}\\b`));
      for (const prose of [
        `const message = 'never reach for ${global}';\n`,
        `const message = "never reach for ${global}";\n`,
        `const message = \`never reach for ${global}\`;\n`,
        `// never reach for ${global}\n`,
        `/* never reach for ${global} */\n`,
      ]) {
        expect(stripCommentsAndStrings(prose), prose.trim()).not.toMatch(
          new RegExp(`\\b${global}\\b`),
        );
      }
    }
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
      // `Error.prototype.toString` is `${name}: ${message}`, so this one
      // assertion pins both the name (a plain `Error`, not a subclass) and the
      // message — with no cast and, crucially, no `if`/`throw` arm that can
      // never execute. §10.7 bans that shape in `src/`, and a test asserting
      // §10.7's discipline should not be written in the shape it bans.
      expect(String(caught)).toMatch(/^Error: NotImplemented/);
    }
  });

  it('holds no §10.3 engine behaviour yet — nothing to mistake for an engine', () => {
    // No Date.now, no timers, no bare Math.random: §10.3's purity ban applies to
    // the stub too, and Sprint 7's lint rule must be green over this file.
    //
    // Read from code, like the import boundary above and for the same reason:
    // §10.3's ban is permanent, so this check outlives the stub, and a body
    // written under it will carry a comment saying which impurity it is avoiding
    // — `// the caller passes dtMs; the engine never reads Date.now` is the
    // discipline, not a breach of it. Greping raw source would make documenting
    // the rule a violation of the rule.
    const code = stripComments(SOURCE);
    for (const banned of BANNED_IMPURITIES) {
      expect(code, banned).not.toContain(banned);
    }
  });

  it('would still catch an impurity in code, and only in code', () => {
    // A negative control for the line above: stripping comments must not have
    // turned the check off. Probed on synthetic sources, because the real file
    // is required to contain neither shape.
    for (const banned of BANNED_IMPURITIES) {
      expect(stripComments(`const t = ${banned}();\n`), banned).toContain(banned);
      expect(stripComments(`// never call ${banned}\n`), banned).not.toContain(banned);
      expect(stripComments(`/* never call ${banned} */\n`), banned).not.toContain(banned);
    }
  });
});
