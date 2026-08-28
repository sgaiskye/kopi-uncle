/**
 * S3-3 — `src/game/view.ts`, part 2 of §10.5's three-part seam.
 *
 * The barrel is implemented for real rather than stubbed, because a stub that
 * merely typechecks unblocks nothing: Track B cannot render a queue card, a mood
 * face or a slot row without these six names.
 *
 * The enumeration and the §7.3 predicate these assertions check against are
 * written out by hand in `./drinks`, independently of `view.ts`, so §7.4's
 * counts are a genuine cross-check rather than the implementation agreeing with
 * itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as view from '../../src/game/view';
import {
  formatOrder,
  isValidDrink,
  moodFor,
  nonDefaultCount,
  SLOT_ROW_LABELS,
  SLOT_VALUE_LABELS,
} from '../../src/game/view';
import type { Drink, Mood } from '../../src/game/types';
import {
  isValidPerSpec,
  RAW_COMBINATIONS,
  SLOT_DEFAULTS,
  SLOT_ORDER,
  SLOT_VALUES,
  VALID_DRINKS,
} from './drinks';
import { importSpecifiers, stripComments } from './source';

/** A §7.1 all-defaults `Kopi`, the R1 builder state, as the base for overrides. */
const PLAIN_KOPI: Drink = {
  base: 'kopi',
  ...SLOT_DEFAULTS,
};

const drink = (overrides: Partial<Drink> = {}): Drink => ({ ...PLAIN_KOPI, ...overrides });

const SOURCE = readFileSync(new URL('../../src/game/view.ts', import.meta.url), 'utf8');

describe('§10.5 — the frozen export surface', () => {
  it('exports exactly the six names §10.5 lists, and nothing else', () => {
    // Compared as sorted lists so nothing can leak into the seam unnoticed: a
    // seventh export here is a contract change, not an implementation detail.
    expect(Object.keys(view).sort()).toEqual(
      [
        'formatOrder',
        'isValidDrink',
        'nonDefaultCount',
        'moodFor',
        'SLOT_ROW_LABELS',
        'SLOT_VALUE_LABELS',
      ].sort(),
    );
  });

  /**
   * §10.5 and Sprint 7's `no-restricted-imports` rule state a **denylist**: what
   * `view.ts` may never reach for. This asserts that, and deliberately does not
   * pin the import list to an exact set.
   *
   * The distinction is load-bearing rather than stylistic. Later sprints are
   * *required* to add imports to this module — S15-1 makes `view.ts` re-export
   * four display helpers from `grammar.ts`, which cannot be done without a
   * `from './grammar'` specifier — while also requiring that the M0 view tests
   * stay green with no edits. `tests/contract/**` is Sprint 3's, so an exact
   * equality here would be a landmine in a file the sprint that trips it is
   * forbidden to defuse. Every property below holds for the life of the module.
   */
  it('imports nothing from the engine, React or the DOM (§10.5, Sprint 7’s rule)', () => {
    const specifiers = importSpecifiers(SOURCE);
    // Not vacuous: the type surface is imported, so the list is never empty.
    expect(specifiers).toContain('./types');
    for (const specifier of specifiers) {
      // Sibling modules inside `src/game/` only — no package, and no path that
      // climbs out of the game core towards `src/app/` or `src/dev/`.
      expect(specifier, specifier).toMatch(/^\.\/[a-z][a-z0-9-]*$/);
    }
    for (const banned of ['./engine', 'react', 'react-dom']) {
      expect(specifiers, banned).not.toContain(banned);
    }
    // The DOM is reached through globals rather than imports, so it needs a
    // separate check — over code with comments stripped, so that prose about
    // the rule cannot break the rule.
    const code = stripComments(SOURCE);
    for (const global of ['document', 'window', 'navigator', 'localStorage']) {
      expect(code, global).not.toMatch(new RegExp(`\\b${global}\\b`));
    }
  });
});

describe('formatOrder — §7.2’s canonical order with defaults omitted', () => {
  it('renders all five §7.2 examples verbatim', () => {
    expect(formatOrder(drink())).toBe('Kopi');
    expect(formatOrder(drink({ milk: 'none' }))).toBe('Kopi O');
    expect(formatOrder(drink({ milk: 'evaporated', sugar: 'siew-dai' }))).toBe('Kopi C siew dai');
    expect(
      formatOrder({
        base: 'teh',
        milk: 'none',
        sugar: 'kosong',
        strength: 'gao',
        temperature: 'peng',
        vessel: 'cup',
      }),
    ).toBe('Teh O kosong gao peng');
    expect(formatOrder(drink({ milk: 'evaporated', temperature: 'peng', vessel: 'bag' }))).toBe(
      'Kopi C peng da bao',
    );
  });

  it('renders §9.3’s longest tier-3 order', () => {
    expect(
      formatOrder({
        base: 'teh',
        milk: 'none',
        sugar: 'kosong',
        strength: 'gao',
        temperature: 'peng',
        vessel: 'bag',
      }),
    ).toBe('Teh O kosong gao peng da bao');
  });

  it('always states the base, first and capitalised, and omits every default', () => {
    for (const one of VALID_DRINKS) {
      const rendered = formatOrder(one);
      const head = one.base === 'kopi' ? 'Kopi' : 'Teh';
      expect(rendered.startsWith(head), rendered).toBe(true);
      // Defaults are unstated (§7.1), so a zero-modifier drink is the base alone.
      expect(rendered === head).toBe(nonDefaultCount(one) === 0);
    }
  });

  it('emits the slots in §7.2 order, never in the order they were written', () => {
    // Same drink, every slot non-default, built by assigning the slots
    // backwards. Output order must come from the module, not the input.
    const backwards: Drink = {
      vessel: 'bag',
      temperature: 'peng',
      strength: 'po',
      sugar: 'ga-dai',
      milk: 'evaporated',
      base: 'teh',
    };
    expect(formatOrder(backwards)).toBe('Teh C ga dai po peng da bao');
  });

  it('produces a distinct string for every one of the 240 valid drinks', () => {
    const rendered = VALID_DRINKS.map(formatOrder);
    expect(new Set(rendered).size).toBe(240);
  });

  it('renders §8.6’s complete tier-1 pool exactly as the PRD lists it', () => {
    const tier1 = VALID_DRINKS.filter((one) => nonDefaultCount(one) <= 1).map(formatOrder);
    expect(tier1.sort()).toEqual(
      [
        'Kopi',
        'Kopi C',
        'Kopi O',
        'Kopi ga dai',
        'Kopi gao',
        'Kopi po',
        'Kopi peng',
        'Kopi da bao',
        'Teh',
        'Teh C',
        'Teh O',
        'Teh ga dai',
        'Teh gao',
        'Teh po',
        'Teh peng',
        'Teh da bao',
      ].sort(),
    );
  });
});

describe('isValidDrink — §7.3, and §7.4’s counts by enumeration', () => {
  it('splits the 288 raw combinations into exactly 240 valid and 48 invalid', () => {
    expect(RAW_COMBINATIONS).toHaveLength(288);
    const valid = RAW_COMBINATIONS.filter(isValidDrink);
    expect(valid).toHaveLength(240);
    expect(RAW_COMBINATIONS.length - valid.length).toBe(48);
  });

  it('agrees with §7.3 written out by hand, on all 288 combinations', () => {
    for (const one of RAW_COMBINATIONS) {
      expect(isValidDrink(one), formatOrder(one)).toBe(isValidPerSpec(one));
    }
  });

  it('rejects exactly condensed × {siew-dai, kosong} and nothing else', () => {
    const invalid = RAW_COMBINATIONS.filter((one) => !isValidDrink(one));
    expect(invalid).toHaveLength(48);
    for (const one of invalid) {
      expect(one.milk).toBe('condensed');
      expect(['siew-dai', 'kosong']).toContain(one.sugar);
    }
  });

  it('accepts ga-dai with condensed milk — §7.3’s named exception', () => {
    expect(isValidDrink(drink({ milk: 'condensed', sugar: 'ga-dai' }))).toBe(true);
    // And with every other milk, so the exception is not accidentally narrow.
    for (const milk of SLOT_VALUES.milk) {
      expect(isValidDrink(drink({ milk, sugar: 'ga-dai' }))).toBe(true);
    }
  });

  it('accepts siew-dai and kosong once the milk is not condensed', () => {
    for (const milk of ['evaporated', 'none'] as const) {
      for (const sugar of ['siew-dai', 'kosong'] as const) {
        expect(isValidDrink(drink({ milk, sugar }))).toBe(true);
      }
    }
    expect(isValidDrink(drink({ milk: 'condensed', sugar: 'siew-dai' }))).toBe(false);
    expect(isValidDrink(drink({ milk: 'condensed', sugar: 'kosong' }))).toBe(false);
  });

  it('ignores the four slots §7.3 says nothing about', () => {
    for (const strength of SLOT_VALUES.strength) {
      for (const temperature of SLOT_VALUES.temperature) {
        for (const vessel of SLOT_VALUES.vessel) {
          expect(isValidDrink(drink({ strength, temperature, vessel }))).toBe(true);
        }
      }
    }
  });
});

describe('nonDefaultCount — §7.4’s distribution, base excluded', () => {
  it('is 0 for plain Kopi and plain Teh, so base never counts', () => {
    expect(nonDefaultCount(drink())).toBe(0);
    expect(nonDefaultCount(drink({ base: 'teh' }))).toBe(0);
  });

  it('counts each of the five modifier slots exactly once', () => {
    expect(nonDefaultCount(drink({ milk: 'none' }))).toBe(1);
    expect(nonDefaultCount(drink({ sugar: 'ga-dai' }))).toBe(1);
    expect(nonDefaultCount(drink({ strength: 'gao' }))).toBe(1);
    expect(nonDefaultCount(drink({ temperature: 'peng' }))).toBe(1);
    expect(nonDefaultCount(drink({ vessel: 'bag' }))).toBe(1);
    expect(
      nonDefaultCount({
        base: 'teh',
        milk: 'none',
        sugar: 'kosong',
        strength: 'po',
        temperature: 'peng',
        vessel: 'bag',
      }),
    ).toBe(5);
  });

  it('reproduces §7.4’s histogram over the 240 valid drinks exactly', () => {
    const histogram: Record<number, number> = {};
    for (const one of VALID_DRINKS) {
      const count = nonDefaultCount(one);
      histogram[count] = (histogram[count] ?? 0) + 1;
    }
    expect(histogram).toEqual({ 0: 2, 1: 14, 2: 46, 3: 82, 4: 72, 5: 24 });
    // 2 + 14 + 46 + 82 + 72 + 24 — the whole space, nothing unclassified.
    expect(Object.values(histogram).reduce((sum, n) => sum + n, 0)).toBe(240);
  });

  it('stays within 0..5 across all 288 raw combinations, valid or not', () => {
    for (const one of RAW_COMBINATIONS) {
      const count = nonDefaultCount(one);
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(5);
      expect(Number.isInteger(count)).toBe(true);
    }
  });
});

describe('moodFor — §9.6’s half-open bands, the only place the ratio is computed', () => {
  it('puts both boundary values in the lower band', () => {
    // p = 0.60 → impatient, not calm.
    expect(moodFor(60, 100)).toBe('impatient');
    // p = 0.30 → angry, not impatient.
    expect(moodFor(30, 100)).toBe('angry');
  });

  it('is calm a thousandth above the upper boundary', () => {
    expect(moodFor(601, 1000)).toBe('calm');
  });

  it('is angry at zero patience', () => {
    expect(moodFor(0, 100)).toBe('angry');
  });

  it('is calm at full patience and impatient just below the upper boundary', () => {
    expect(moodFor(100, 100)).toBe('calm');
    expect(moodFor(599, 1000)).toBe('impatient');
    expect(moodFor(301, 1000)).toBe('impatient');
    expect(moodFor(299, 1000)).toBe('angry');
  });

  it('agrees with §9.6’s table at every tenth of a percent', () => {
    for (let permille = 0; permille <= 1000; permille += 1) {
      const p = permille / 1000;
      const expected: Mood = p > 0.6 ? 'calm' : p > 0.3 ? 'impatient' : 'angry';
      expect(moodFor(permille, 1000), `p = ${String(p)}`).toBe(expected);
    }
  });

  /**
   * **Ruled here, per §13's never-ask instruction and S3-3's criterion.**
   *
   * A zero or negative `maxPatienceMs` is not reachable from `config.ts` — every
   * §8.5 patience is positive — but `moodFor` is on the frozen seam and Track B
   * calls it with whatever a fixture or a partially-initialised card holds. The
   * ruling: **`maxPatienceMs <= 0` returns `'angry'`**, the safest band, rather
   * than dividing and producing `NaN`, `Infinity` or `-Infinity` — each of which
   * would fall through every `>` comparison to a band chosen by accident. This
   * keeps the return type total and the build green and reversible.
   */
  it('returns angry rather than NaN when maxPatienceMs is zero or negative', () => {
    expect(moodFor(100, 0)).toBe('angry');
    expect(moodFor(0, 0)).toBe('angry');
    expect(moodFor(100, -1)).toBe('angry');
    expect(moodFor(-100, 0)).toBe('angry');
  });

  it('never returns a value outside the Mood union, for any pair of numbers', () => {
    const moods: Mood[] = ['calm', 'impatient', 'angry'];
    for (const patienceMs of [-1, 0, 1, 99, 100, 101, Number.NaN]) {
      for (const maxPatienceMs of [-1, 0, 1, 100, Number.NaN]) {
        expect(moods).toContain(moodFor(patienceMs, maxPatienceMs));
      }
    }
  });
});

describe('SLOT_ROW_LABELS — §9.5’s six wireframe row labels', () => {
  it('holds exactly the six §9.5 labels, keyed in §7.2 order', () => {
    expect(SLOT_ROW_LABELS).toEqual({
      base: 'BASE',
      milk: 'MILK',
      sugar: 'SUGAR',
      strength: 'BREW',
      temperature: 'TEMP',
      vessel: 'TAKE',
    });
    expect(Object.keys(SLOT_ROW_LABELS)).toEqual([...SLOT_ORDER]);
  });

  it('is frozen, so a component cannot rewrite the wireframe', () => {
    expect(Object.isFrozen(SLOT_ROW_LABELS)).toBe(true);
  });
});

/**
 * The six slot label records, unwrapped one at a time.
 *
 * `SLOT_VALUE_LABELS[slot]` for a *union* `slot` is a union of six records with
 * disjoint literal keys, which nothing generic can iterate under `strict`. Naming
 * the six is not repetition for its own sake: it is what lets the assertions
 * below stay type-safe without spending a cast. Completeness is not left to
 * inspection either — the first assertion below compares this table's slots to
 * `SLOT_ORDER`, which `./drinks` pins to `keyof Drink`, so a seventh slot fails
 * the suite rather than being silently skipped.
 */
const LABEL_RECORDS: readonly [keyof Drink, Record<string, string>, readonly string[]][] = [
  ['base', { ...SLOT_VALUE_LABELS.base }, [...SLOT_VALUES.base]],
  ['milk', { ...SLOT_VALUE_LABELS.milk }, [...SLOT_VALUES.milk]],
  ['sugar', { ...SLOT_VALUE_LABELS.sugar }, [...SLOT_VALUES.sugar]],
  ['strength', { ...SLOT_VALUE_LABELS.strength }, [...SLOT_VALUES.strength]],
  ['temperature', { ...SLOT_VALUE_LABELS.temperature }, [...SLOT_VALUES.temperature]],
  ['vessel', { ...SLOT_VALUE_LABELS.vessel }, [...SLOT_VALUES.vessel]],
];

describe('SLOT_VALUE_LABELS — one label per slot value, 2+3+4+3+2+2 = 16', () => {
  it('unwraps all six slots, in §7.2 order — the table below is complete', () => {
    expect(LABEL_RECORDS.map(([slot]) => slot)).toEqual([...SLOT_ORDER]);
  });

  it('covers every value of every slot union, with no extras', () => {
    let labelled = 0;
    for (const [slot, labels, values] of LABEL_RECORDS) {
      expect(Object.keys(labels).sort(), slot).toEqual([...values].sort());
      labelled += Object.keys(labels).length;
    }
    expect(labelled).toBe(16);
  });

  it('gives every value a non-empty label that is unique within its slot', () => {
    for (const [slot, labels, values] of LABEL_RECORDS) {
      const seen = new Set<string>();
      for (const value of values) {
        const label = labels[value];
        expect(typeof label, `${slot}.${value}`).toBe('string');
        expect(label.trim().length, `${slot}.${value} is blank`).toBeGreaterThan(0);
        expect(seen.has(label), `${slot}.${value} duplicates "${label}"`).toBe(false);
        seen.add(label);
      }
    }
  });

  it('uses §7.1’s spoken form wherever one exists', () => {
    expect(SLOT_VALUE_LABELS.milk.evaporated).toBe('C');
    expect(SLOT_VALUE_LABELS.milk.none).toBe('O');
    expect(SLOT_VALUE_LABELS.sugar['siew-dai']).toBe('siew dai');
    expect(SLOT_VALUE_LABELS.sugar['ga-dai']).toBe('ga dai');
    expect(SLOT_VALUE_LABELS.sugar.kosong).toBe('kosong');
    expect(SLOT_VALUE_LABELS.strength.gao).toBe('gao');
    expect(SLOT_VALUE_LABELS.strength.po).toBe('po');
    expect(SLOT_VALUE_LABELS.temperature.peng).toBe('peng');
    expect(SLOT_VALUE_LABELS.vessel.bag).toBe('da bao');

    // All nine §7.1 spoken forms are present and none was quietly dropped.
    const all = LABEL_RECORDS.flatMap(([, labels]) => Object.values(labels));
    for (const spoken of [
      'C',
      'O',
      'siew dai',
      'ga dai',
      'kosong',
      'gao',
      'po',
      'peng',
      'da bao',
    ]) {
      expect(all, spoken).toContain(spoken);
    }
  });

  it('labels the slots §9.5 shows as words with those words', () => {
    expect(SLOT_VALUE_LABELS.base.kopi).toBe('kopi');
    expect(SLOT_VALUE_LABELS.base.teh).toBe('teh');
    expect(SLOT_VALUE_LABELS.temperature.hot).toBe('hot');
    expect(SLOT_VALUE_LABELS.vessel.cup).toBe('cup');
  });

  it('is frozen recursively, per §10.3’s Object.freeze requirement', () => {
    expect(Object.isFrozen(SLOT_VALUE_LABELS)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.base)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.milk)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.sugar)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.strength)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.temperature)).toBe(true);
    expect(Object.isFrozen(SLOT_VALUE_LABELS.vessel)).toBe(true);
  });

  it('carries no label that is only a colour or a bare glyph (§9.2, §9.7)', () => {
    for (const [slot, labels] of LABEL_RECORDS) {
      for (const label of Object.values(labels)) {
        // Latin letters and single spaces only — a screen reader has to say it.
        expect(label, `${slot}: "${label}"`).toMatch(/^[a-z]+( [a-z]+)*$/i);
      }
    }
  });
});
