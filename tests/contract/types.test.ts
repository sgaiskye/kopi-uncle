/**
 * S3-1 — the type surface of §10.3.
 *
 * Every assertion here is either a compile-time `expectTypeOf` / `satisfies`
 * check or a runtime sweep. The compile-time half is enforced by
 * `npm run typecheck` (which compiles `tests/` — see `tsconfig.json`) *and* by
 * `npm run test`, because `tests/contract/typecheck.test.ts` runs the compiler
 * inside the Vitest run. A drifted contract is therefore a gate failure twice
 * over rather than a review opinion.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, expectTypeOf } from 'vitest';
import {
  setSlot,
  type Action,
  type ActionType,
  type Base,
  type Drink,
  type GameEvent,
  type GameState,
  type Milk,
  type Mood,
  type Phase,
  type ServeResult,
  type SetSlot,
  type ShiftId,
  type Strength,
  type Sugar,
  type Temperature,
  type Tier,
  type UnhandledActionType,
  type Vessel,
} from '../../src/game/types';
import { SLOT_ORDER, SLOT_VALUES, VALID_DRINKS } from './drinks';
import { castsIn } from './source';

/** §10.3's cast budget is stated for the whole of `src/game/`, so scan it all. */
const GAME_DIR = fileURLToPath(new URL('../../src/game/', import.meta.url));

describe('§10.3 unions', () => {
  it('declares Phase, Mode, Tier, ShiftId, Mood and ServeResult verbatim', () => {
    expectTypeOf<Phase>().toEqualTypeOf<'title' | 'playing' | 'paused' | 'break' | 'gameover'>();
    expectTypeOf<Tier>().toEqualTypeOf<1 | 2 | 3>();
    expectTypeOf<ShiftId>().toEqualTypeOf<'breakfast' | 'lunch' | 'tea' | 'supper'>();
    expectTypeOf<Mood>().toEqualTypeOf<'calm' | 'impatient' | 'angry'>();
    expectTypeOf<ServeResult>().toEqualTypeOf<'clean' | 'fumbled' | 'walkout'>();
  });

  it('declares the six slot unions of §7.1', () => {
    expectTypeOf<Base>().toEqualTypeOf<'kopi' | 'teh'>();
    expectTypeOf<Milk>().toEqualTypeOf<'condensed' | 'evaporated' | 'none'>();
    expectTypeOf<Sugar>().toEqualTypeOf<'normal' | 'siew-dai' | 'ga-dai' | 'kosong'>();
    expectTypeOf<Strength>().toEqualTypeOf<'normal' | 'gao' | 'po'>();
    expectTypeOf<Temperature>().toEqualTypeOf<'hot' | 'peng'>();
    expectTypeOf<Vessel>().toEqualTypeOf<'cup' | 'bag'>();
  });

  it('declares Drink with exactly the six slots, in §7.2 order', () => {
    expectTypeOf<keyof Drink>().toEqualTypeOf<
      'base' | 'milk' | 'sugar' | 'strength' | 'temperature' | 'vessel'
    >();
    // Declaration order is load-bearing: §7.5 makes it the stable enumeration
    // order that Daily reproducibility depends on.
    expect(Object.keys(VALID_DRINKS[0])).toEqual([...SLOT_ORDER]);
  });

  it('declares GameEvent with exactly the seven §10.3 variants', () => {
    expectTypeOf<GameEvent['type']>().toEqualTypeOf<
      'arrived' | 'served' | 'fumbled' | 'walkout' | 'heartLost' | 'shiftCleared' | 'gameOver'
    >();
    expectTypeOf<Extract<GameEvent, { type: 'served' }>>().toEqualTypeOf<{
      type: 'served';
      customerId: number;
      points: number;
    }>();
    expectTypeOf<Extract<GameEvent, { type: 'shiftCleared' }>>().toEqualTypeOf<{
      type: 'shiftCleared';
      shiftIndex: number;
      bonus: number;
    }>();
    expectTypeOf<Extract<GameEvent, { type: 'heartLost' }>>().toEqualTypeOf<{
      type: 'heartLost';
      remaining: number;
    }>();
    expectTypeOf<Extract<GameEvent, { type: 'gameOver' }>>().toEqualTypeOf<{ type: 'gameOver' }>();
  });
});

describe('§10.3 GameState', () => {
  /**
   * `Record<keyof GameState, true>` makes this exhaustive at compile time: a
   * field added to `GameState` without being listed here fails typecheck, and a
   * field listed here that `GameState` does not declare fails too. The runtime
   * length assertion then pins the count.
   *
   * §10.3 enumerates 22 fields. Sprint 3's plan text says "all twenty fields";
   * the PRD is the contract, so all 22 are declared and asserted.
   */
  const GAME_STATE_FIELDS: Record<keyof GameState, true> = {
    phase: true,
    mode: true,
    queue: true,
    activeId: true,
    builder: true,
    hearts: true,
    comboTenths: true,
    bestComboTenths: true,
    score: true,
    shiftIndex: true,
    spawnedInShift: true,
    servedInShift: true,
    walkoutsInShift: true,
    servesAttempted: true,
    servesCorrect: true,
    lockoutMs: true,
    nextArrivalMs: true,
    nextCustomerId: true,
    rngState: true,
    tickRemainderMs: true,
    shiftResults: true,
    frameEvents: true,
  };

  it('declares every §10.3 field and no others', () => {
    expect(Object.keys(GAME_STATE_FIELDS)).toHaveLength(22);
  });

  it('types the fields whose shape the tracks read directly', () => {
    expectTypeOf<GameState['queue']>().toEqualTypeOf<import('../../src/game/types').Customer[]>();
    expectTypeOf<GameState['activeId']>().toEqualTypeOf<number | null>();
    expectTypeOf<GameState['builder']>().toEqualTypeOf<Drink>();
    expectTypeOf<GameState['shiftResults']>().toEqualTypeOf<ServeResult[][]>();
    expectTypeOf<GameState['frameEvents']>().toEqualTypeOf<GameEvent[]>();
  });

  it('declares Customer with exactly the five §10.3 fields', () => {
    const fields: Record<keyof import('../../src/game/types').Customer, true> = {
      id: true,
      order: true,
      maxPatienceMs: true,
      patienceMs: true,
      fumbled: true,
    };
    expect(Object.keys(fields)).toHaveLength(5);
  });
});

describe('§10.3 SetSlot', () => {
  it('expands to exactly six variants, one per slot', () => {
    type PerSlot =
      | Extract<SetSlot, { slot: 'base' }>
      | Extract<SetSlot, { slot: 'milk' }>
      | Extract<SetSlot, { slot: 'sugar' }>
      | Extract<SetSlot, { slot: 'strength' }>
      | Extract<SetSlot, { slot: 'temperature' }>
      | Extract<SetSlot, { slot: 'vessel' }>;
    // If a seventh variant existed, `SetSlot` would be wider than the union of
    // the six extractions and this would not compile.
    expectTypeOf<PerSlot>().toEqualTypeOf<SetSlot>();
    expectTypeOf<SetSlot['slot']>().toEqualTypeOf<keyof Drink>();
    expectTypeOf<SetSlot['type']>().toEqualTypeOf<'SET_SLOT'>();
  });

  it('correlates each slot with exactly its own value union', () => {
    expectTypeOf<Extract<SetSlot, { slot: 'base' }>['value']>().toEqualTypeOf<Base>();
    expectTypeOf<Extract<SetSlot, { slot: 'milk' }>['value']>().toEqualTypeOf<Milk>();
    expectTypeOf<Extract<SetSlot, { slot: 'sugar' }>['value']>().toEqualTypeOf<Sugar>();
    expectTypeOf<Extract<SetSlot, { slot: 'strength' }>['value']>().toEqualTypeOf<Strength>();
    expectTypeOf<Extract<SetSlot, { slot: 'temperature' }>['value']>().toEqualTypeOf<Temperature>();
    expectTypeOf<Extract<SetSlot, { slot: 'vessel' }>['value']>().toEqualTypeOf<Vessel>();
  });

  it('has no variant for a slot that is not a keyof Drink', () => {
    expectTypeOf<Extract<SetSlot, { slot: 'flavour' }>>().toBeNever();
  });
});

describe('§10.3 Action', () => {
  it("Action['type'] is exactly the seven declared literals", () => {
    expectTypeOf<Action['type']>().toEqualTypeOf<
      'START_RUN' | 'FOCUS' | 'SET_SLOT' | 'SERVE' | 'DISMISS_BREAK' | 'PAUSE' | 'RESUME'
    >();
    expectTypeOf<Action['type']>().toEqualTypeOf<ActionType>();
  });

  it('is exhaustive by a `satisfies never` assignment, not a runtime default arm', () => {
    // The assignment at the foot of this file *is* the proof, and it carries no
    // runtime statement: no `throw`, no side effect, nothing that could ever
    // become an uncovered line. §10.7 bans `default: throw` over a closed union
    // for exactly that reason. Both assertions here are compile-time only.
    expectTypeOf(EXHAUSTIVE_OVER_ACTION).toBeNever();
    expectTypeOf<UnhandledActionType>().toBeNever();
    // `expectTypeOf` is erased, so without this the body would pass even if it
    // were deleted. The proof stays the compile-time pair (TS1360 here, TS2344
    // on `types.ts`'s own constraint); this is what makes the *test* non-vacuous
    // and keeps the assignment it names from being dead-code-eliminated.
    expect(EXHAUSTIVE_OVER_ACTION).toBeUndefined();
  });

  it('carries the payloads §10.3 specifies', () => {
    expectTypeOf<Extract<Action, { type: 'START_RUN' }>>().toEqualTypeOf<{
      type: 'START_RUN';
      mode: import('../../src/game/types').Mode;
      seed: number;
    }>();
    expectTypeOf<Extract<Action, { type: 'FOCUS' }>>().toEqualTypeOf<{
      type: 'FOCUS';
      customerId: number;
    }>();
    expectTypeOf<Extract<Action, { type: 'SET_SLOT' }>>().toEqualTypeOf<SetSlot>();
    expectTypeOf<Extract<Action, { type: 'SERVE' }>>().toEqualTypeOf<{ type: 'SERVE' }>();
  });
});

describe('§10.3 setSlot', () => {
  it('has the generic signature the contract specifies', () => {
    expectTypeOf(setSlot).toBeFunction();
    expectTypeOf(setSlot).parameter(0).toEqualTypeOf<Drink>();
    expectTypeOf(setSlot).returns.toEqualTypeOf<Drink>();
    // The correlation §10.3 exists for: `value` is narrowed by `slot`.
    expectTypeOf(setSlot<'sugar'>)
      .parameter(2)
      .toEqualTypeOf<Sugar>();
    expectTypeOf(setSlot<'vessel'>)
      .parameter(2)
      .toEqualTypeOf<Vessel>();
  });

  it('returns a new object leaving the other five slots strictly equal, over all 240 × 6', () => {
    expect(VALID_DRINKS).toHaveLength(240);
    let assertions = 0;

    for (const drink of VALID_DRINKS) {
      for (const slot of SLOT_ORDER) {
        for (const value of SLOT_VALUES[slot]) {
          // The generic is instantiated per slot, which is what makes `value`
          // assignable without a cast at the call site.
          const next = setSlot(drink, slot, value);

          expect(next).not.toBe(drink);
          expect(next[slot]).toBe(value);
          for (const other of SLOT_ORDER) {
            if (other === slot) continue;
            expect(next[other]).toBe(drink[other]);
          }
          expect(Object.keys(next)).toEqual([...SLOT_ORDER]);
          assertions += 1;
        }
      }
    }

    // 240 drinks × 16 slot values = 3840 rewrites, covering all 240 × 6 slots.
    expect(assertions).toBe(240 * 16);
  });

  it('is the only place in the contract permitted to spend a cast, and spends at most one', () => {
    // §10.3 sanctions exactly one cast for the whole type surface and names
    // `setSlot` as where it may live. Under TypeScript 5.9 the computed-key
    // spread relates to `Drink` unaided, so the budget is currently unspent —
    // writing the assertion anyway would be flagged by
    // `@typescript-eslint/no-unnecessary-type-assertion` once Sprint 2's
    // type-aware linter lands. What must never happen is a *second* cast
    // appearing, so the budget is asserted rather than the exact count.
    //
    // The budget `types.ts` claims is for the whole of `src/game/`, so the scan
    // covers the whole directory rather than only the file that states it:
    // a cast smuggled into `config.ts`, `view.ts` or `engine.ts` — the three
    // files later sprints edit — spends the same single allowance.
    const files = readdirSync(GAME_DIR).filter((entry) => entry.endsWith('.ts'));
    // Not vacuous: the four §10.5 files at minimum, and `types.ts` among them.
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain('types.ts');

    const texts = files.map((file) => ({ file, text: readFileSync(join(GAME_DIR, file), 'utf8') }));
    const spent = texts.flatMap(({ file, text }) =>
      castsIn(text).map((cast) => `${file}: ${cast}`),
    );
    expect(spent.length, `casts found — ${spent.join(', ')}`).toBeLessThanOrEqual(1);

    // Not vacuous in the other direction either. A scanner that stopped reading
    // part-way through a file — the way an unlexed regex literal's quote once
    // made it — reports an empty list, and this bound then holds whatever the
    // files contain. So every file is scanned a second time with a cast appended,
    // and the cast has to be found: proof the scan reaches the end of each of
    // them and that the check above was looking at the whole file.
    for (const { file, text } of texts) {
      expect(castsIn(`${text}\nconst probe = value as Drink;\n`), file).toContain('as Drink');
    }
  });

  it('detects all three cast forms, so the budget cannot be spent around it', () => {
    // The guard is only worth its line if it recognises the ways a cast can be
    // written. Probed against the scanner rather than asserted by inspection.
    expect(castsIn('const a = b as Drink;\n')).toEqual(['as Drink']);
    expect(castsIn('const a = <Drink>b;\n')).toEqual(['<Drink>b']);
    expect(castsIn('const a = b.c!;\n')).toEqual(['c!']);
    // A cast does not have to be the whole of a statement. Each of these spends
    // the budget exactly as the three above do, and the name of this test is a
    // promise that none of them is a way around it — an argument position in
    // particular, where a `!` is followed by the `)` that closes the call.
    expect(castsIn('serve(active!);\n')).toEqual(['e!']);
    expect(castsIn('serve(queue[0]!);\n')).toEqual([']!']);
    expect(castsIn('serve(head()!);\n')).toEqual([')!']);
    expect(castsIn('const a = <Drink>(b);\n')).toEqual(['<Drink>(']);
    // A regular-expression literal is not a way around it either. Its quote used
    // to open a string that never closed, after which the scan returned nothing
    // for the rest of the file and this guard passed on a file that had spent the
    // budget. `source.ts` now lexes regexes; `source.test.ts` probes that
    // directly, and this is the consequence the budget cares about.
    expect(castsIn(`const QUOTED = /['"]/;\nconst a = b as Drink;\n`)).toEqual(['as Drink']);
    // And the things that are not casts stay unflagged.
    for (const notACast of [
      'const a = [1] as const;\n',
      'const a = deepFreeze<GameConfig>({});\n',
      'type A<T> = Readonly<Record<string, T>>;\n',
      'if (a !== b) return;\n',
      'if (!(a > 0)) return;\n',
      'if (!list.length) return;\n',
      'serve(!wrong);\n',
      '// treated as Drink by the caller\n',
      "const message = 'counts as Drink';\n",
      // A generic arrow *declares* a type parameter where a cast *asserts* one.
      // Both open `<T>(`, so the two are told apart by the `=>` that closes the
      // parameter list. §10.3 does not ration generics, and Sprint 15's display
      // helpers are free to be written this way.
      'const identity = <T>(x: T) => x;\n',
      'const identity = <T>(x: T): T => x;\n',
      'const frozen = <T>(x: T): Readonly<T> => x;\n',
      'const first = <T>(xs: readonly T[], pick: (x: T) => boolean) => xs.find(pick);\n',
      'const none = <T>() => undefined;\n',
    ]) {
      expect(castsIn(notACast), notACast.trim()).toEqual([]);
    }
  });

  it('does not mutate its input', () => {
    const drink: Drink = { ...VALID_DRINKS[0] };
    const before = JSON.stringify(drink);
    setSlot(drink, 'vessel', 'bag');
    expect(JSON.stringify(drink)).toBe(before);
  });
});

/**
 * S3-1's compile-time exhaustiveness proof over `Action`, per §10.7: **a
 * `satisfies never` assignment with no runtime statement.**
 *
 * `UnhandledActionType` is `Exclude<Action['type'], ActionType>`, so it collapses
 * to `never` exactly while every declared variant is accounted for. Add an
 * eighth variant to `Action` without listing it in `ActionType` and this line
 * stops compiling — TS1360, alongside TS2344 on `types.ts`'s own
 * `ActionTypesAreExhaustive` constraint, which is the fully zero-emit half of
 * the same proof.
 *
 * §10.7 bans a runtime `default: throw` arm over a closed union because an
 * unreachable line can never be covered. This assignment has no arm to be
 * unreachable: it declares a value, asserts a type relation, and does nothing.
 */
const EXHAUSTIVE_OVER_ACTION = undefined as unknown as UnhandledActionType satisfies never;
