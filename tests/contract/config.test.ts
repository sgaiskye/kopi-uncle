/**
 * S3-2 — `src/game/config.ts`, the one file §10.4 puts every §8 number in, and
 * the three selectors that own the three formulas the shift table cannot express
 * flatly: tea's mid-shift tier split, supper's per-customer patience decay, and
 * Endless holding gap and patience at their floors.
 *
 * **No §8.5 value is written as a literal in this file.** They are expressed as
 * seconds through `sec()`, so the millisecond forms §10.4 reserves to
 * `config.ts` appear nowhere else — including here. The single-source test at
 * the foot of this file is what enforces that repo-wide, and it builds its own
 * banned list the same way so it does not trip over itself.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG, gapMsFor, patienceMsFor, tierFor } from '../../src/game/config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Seconds → integer milliseconds. §8.5 is written in seconds; R20 is integers. */
const sec = (seconds: number): number => Math.round(seconds * 1000);

const BREAKFAST = 0;
const LUNCH = 1;
const TEA = 2;
const SUPPER = 3;

describe('§10.4 — every §8 constant, in one frozen object', () => {
  it('holds the scalars §8 names', () => {
    expect(CONFIG.QUEUE_CAP).toBe(3); // §8.7
    expect(CONFIG.HEARTS).toBe(3); // §8.3
    expect(CONFIG.PATIENCE_FLOOR_MS).toBe(sec(2)); // R7, §13.3
    expect(CONFIG.WRONG_SERVE_PENALTY_FRACTION).toBe(35 / 100); // R7
    expect(CONFIG.LOCKOUT_MS).toBe(600); // R5
    expect(CONFIG.COMBO_STEP_TENTHS).toBe(1); // §8.8
    expect(CONFIG.COMBO_MIN_TENTHS).toBe(10); // §8.8
    expect(CONFIG.COMBO_MAX_TENTHS).toBe(30); // §8.8
    expect(CONFIG.BASE_POINTS).toBe(100); // §8.8
    expect(CONFIG.SHIFT_CLEAR_BONUS).toBe(500); // §8.8, R15
    expect(CONFIG.TICK_MS).toBe(16); // R20
    expect(CONFIG.MAX_FRAME_MS).toBe(250); // R20
  });

  it('holds §8.5 as a four-entry shift table', () => {
    expect(CONFIG.SHIFTS.map((shift) => shift.id)).toEqual(['breakfast', 'lunch', 'tea', 'supper']);
    expect(CONFIG.SHIFTS.map((shift) => shift.customers)).toEqual([6, 8, 10, 10]);
    expect(CONFIG.SHIFTS.map((shift) => shift.tier)).toEqual([1, 2, 2, 3]);
    expect(CONFIG.SHIFTS.map((shift) => shift.patienceMs)).toEqual([
      sec(18),
      sec(16),
      sec(14),
      sec(12),
    ]);
    expect(CONFIG.SHIFTS.map((shift) => [shift.gapStartMs, shift.gapEndMs])).toEqual([
      [sec(6), sec(4)],
      [sec(5), sec(3)],
      [sec(4), sec(2.5)],
      [sec(3), sec(2)],
    ]);
  });

  it('carries tea’s mid-shift tier split and supper’s patience decay as table data', () => {
    expect(CONFIG.SHIFTS[TEA].tierSplit).toEqual({ fromCustomer: 6, tier: 3 });
    expect(CONFIG.SHIFTS.filter((shift) => shift.tierSplit !== null)).toHaveLength(1);
    expect(CONFIG.SHIFTS[SUPPER].patienceDecayPerCustomerMs).toBe(200);
    expect(CONFIG.SHIFTS[SUPPER].patienceFloorMs).toBe(sec(10));
    for (const index of [BREAKFAST, LUNCH, TEA]) {
      expect(CONFIG.SHIFTS[index].patienceDecayPerCustomerMs).toBe(0);
    }
  });

  it('is frozen recursively, per §10.3’s Object.freeze requirement', () => {
    const seen = new Set<unknown>();
    const paths: string[] = [];

    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      paths.push(path);
      expect(Object.isFrozen(value), `${path} is not frozen`).toBe(true);
      for (const [key, inner] of Object.entries(value)) {
        walk(inner, `${path}.${key}`);
      }
    };

    walk(CONFIG, 'CONFIG');
    // The object, the table and all four entries at minimum.
    expect(paths.length).toBeGreaterThanOrEqual(6);
    expect(Object.isFrozen(CONFIG.SHIFTS)).toBe(true);
    for (const shift of CONFIG.SHIFTS) {
      expect(Object.isFrozen(shift)).toBe(true);
    }
    expect(Object.isFrozen(CONFIG.SHIFTS[TEA].tierSplit)).toBe(true);
  });

  it('refuses a write at runtime as well as at compile time', () => {
    const mutate = (): void => {
      (CONFIG.SHIFTS[BREAKFAST] as { customers: number }).customers = 99;
    };
    expect(mutate).toThrow(TypeError);
    expect(CONFIG.SHIFTS[BREAKFAST].customers).toBe(6);
  });
});

describe('tierFor — §8.6, asserted at customers 1, N and N+1 of every shift', () => {
  it('breakfast is tier 1 throughout', () => {
    expect(tierFor(BREAKFAST, 1)).toBe(1);
    expect(tierFor(BREAKFAST, 6)).toBe(1);
    expect(tierFor(BREAKFAST, 7)).toBe(1);
  });

  it('lunch is tier 2 throughout', () => {
    expect(tierFor(LUNCH, 1)).toBe(2);
    expect(tierFor(LUNCH, 8)).toBe(2);
    expect(tierFor(LUNCH, 9)).toBe(2);
  });

  it('tea splits mid-shift: tier 2 at customer 5, tier 3 at customer 6 (both sides, R17)', () => {
    expect(tierFor(TEA, 1)).toBe(2);
    expect(tierFor(TEA, 5)).toBe(2);
    expect(tierFor(TEA, 6)).toBe(3);
    expect(tierFor(TEA, 10)).toBe(3);
    expect(tierFor(TEA, 11)).toBe(3);
  });

  it('supper is tier 3 throughout, including the Endless floor-held case', () => {
    expect(tierFor(SUPPER, 1)).toBe(3);
    expect(tierFor(SUPPER, 10)).toBe(3);
    expect(tierFor(SUPPER, 11)).toBe(3);
    expect(tierFor(4, 1)).toBe(3); // shiftIndex is pinned at 3 in Endless (§10.3)
  });
});

describe('gapMsFor — §8.5’s linear interpolation', () => {
  it('breakfast interpolates 6.0s → 4.0s and clamps past N', () => {
    expect(gapMsFor(BREAKFAST, 1)).toBe(sec(6));
    expect(gapMsFor(BREAKFAST, 6)).toBe(sec(4));
    expect(gapMsFor(BREAKFAST, 7)).toBe(sec(4));
  });

  it('lunch interpolates 5.0s → 3.0s and clamps past N', () => {
    expect(gapMsFor(LUNCH, 1)).toBe(sec(5));
    expect(gapMsFor(LUNCH, 8)).toBe(sec(3));
    expect(gapMsFor(LUNCH, 9)).toBe(sec(3));
  });

  it('tea interpolates 4.0s → 2.5s and clamps past N', () => {
    expect(gapMsFor(TEA, 1)).toBe(sec(4));
    expect(gapMsFor(TEA, 10)).toBe(sec(2.5));
    expect(gapMsFor(TEA, 11)).toBe(sec(2.5));
  });

  it('supper interpolates 3.0s → 2.0s, and holds the floor for Endless (gapMsFor(3, 11))', () => {
    expect(gapMsFor(SUPPER, 1)).toBe(sec(3));
    expect(gapMsFor(SUPPER, 10)).toBe(sec(2));
    expect(gapMsFor(SUPPER, 11)).toBe(sec(2));
    expect(gapMsFor(SUPPER, 25)).toBe(sec(2));
  });

  it('is `gap(i) = start + (end − start) × (i − 1) / (N − 1)` at every customer', () => {
    for (const shift of CONFIG.SHIFTS) {
      const index = CONFIG.SHIFTS.indexOf(shift);
      for (let i = 1; i <= shift.customers; i += 1) {
        const expected = Math.round(
          shift.gapStartMs +
            ((shift.gapEndMs - shift.gapStartMs) * (i - 1)) / (shift.customers - 1),
        );
        expect(gapMsFor(index, i)).toBe(expected);
        expect(Number.isInteger(gapMsFor(index, i))).toBe(true); // R20
      }
    }
  });

  it('tightens monotonically within a shift — §8.5’s sawtooth, not a plateau', () => {
    for (let index = 0; index < CONFIG.SHIFTS.length; index += 1) {
      const gaps = Array.from({ length: CONFIG.SHIFTS[index].customers }, (_unused, i) =>
        gapMsFor(index, i + 1),
      );
      for (let i = 1; i < gaps.length; i += 1) {
        expect(gaps[i]).toBeLessThan(gaps[i - 1]);
      }
    }
  });

  it('clamps a customer index below 1 rather than extrapolating', () => {
    expect(gapMsFor(BREAKFAST, 0)).toBe(sec(6));
  });
});

describe('patienceMsFor — §8.5’s constants, and supper’s decay to its floor', () => {
  it('is constant within each of the first three shifts, at i = 1, N and N+1', () => {
    for (const [index, seconds, customers] of [
      [BREAKFAST, 18, 6],
      [LUNCH, 16, 8],
      [TEA, 14, 10],
    ] as const) {
      expect(patienceMsFor(index, 1)).toBe(sec(seconds));
      expect(patienceMsFor(index, customers)).toBe(sec(seconds));
      expect(patienceMsFor(index, customers + 1)).toBe(sec(seconds));
    }
  });

  it('decays supper by 0.2s per customer to a 10.0s floor', () => {
    expect(patienceMsFor(SUPPER, 1)).toBe(sec(12));
    expect(patienceMsFor(SUPPER, 10)).toBe(sec(10.2));
    expect(patienceMsFor(SUPPER, 11)).toBe(sec(10));
    expect(patienceMsFor(SUPPER, 25)).toBe(sec(10)); // Endless, held at the floor
  });

  it('never returns a non-integer or a value below the §8.5 floor', () => {
    for (let index = 0; index < CONFIG.SHIFTS.length; index += 1) {
      for (let i = 1; i <= 40; i += 1) {
        const patience = patienceMsFor(index, i);
        expect(Number.isInteger(patience)).toBe(true); // R20
        expect(patience).toBeGreaterThanOrEqual(CONFIG.SHIFTS[index].patienceFloorMs);
      }
    }
  });

  it('clamps a customer index below 1 rather than extrapolating upward', () => {
    expect(patienceMsFor(SUPPER, 0)).toBe(sec(12));
  });
});

/**
 * **Ruled here, per §13's never-ask instruction, on the same grounds as
 * `moodFor`'s `maxPatienceMs <= 0` band.**
 *
 * A non-finite argument is not reachable from any current code path — nothing
 * calls these three yet — but they are on the frozen seam and Track A code that
 * does not exist yet will call them with whatever a partially-initialised
 * `GameState` holds. Unguarded, `NaN` survives `Math.trunc` and both clamps, so
 * `shiftAt` indexed the table with `NaN` and all three selectors threw a
 * `TypeError`; a `NaN` `customerIndex` was worse still, returning a `NaN` gap
 * that would silently poison `nextArrivalMs` rather than announcing itself.
 *
 * The ruling: **`NaN` resolves to the first shift and to customer 1** — the
 * gentlest point on §8.5's curve, chosen for the same reason `moodFor` picks the
 * safest band. The infinities are ordered, so they are left to the clamps, which
 * carry them to the ends of the range — asserted below too, so the guard cannot
 * quietly swallow §8.5's Endless clamp.
 */
describe('the three selectors are total, as moodFor is', () => {
  const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('never throws and never returns NaN, for any pair of non-finite arguments', () => {
    for (const shiftIndex of [...NON_FINITE, 0, SUPPER]) {
      for (const customerIndex of [...NON_FINITE, 1]) {
        expect(() => tierFor(shiftIndex, customerIndex)).not.toThrow();
        expect(Number.isInteger(gapMsFor(shiftIndex, customerIndex))).toBe(true);
        expect(Number.isInteger(patienceMsFor(shiftIndex, customerIndex))).toBe(true);
      }
    }
  });

  it('resolves a NaN shiftIndex to the first shift', () => {
    expect(tierFor(Number.NaN, 1)).toBe(CONFIG.SHIFTS[BREAKFAST].tier);
    expect(gapMsFor(Number.NaN, 1)).toBe(sec(6));
    expect(patienceMsFor(Number.NaN, 1)).toBe(sec(18));
  });

  it('resolves a NaN customerIndex to customer 1', () => {
    // Tea's split starts at customer 6, so customer 1 is the pre-split tier.
    expect(tierFor(TEA, Number.NaN)).toBe(2);
    expect(gapMsFor(SUPPER, Number.NaN)).toBe(sec(3));
    expect(patienceMsFor(SUPPER, Number.NaN)).toBe(sec(12));
  });

  it('leaves the infinities to the clamps, so §8.5’s ends still hold', () => {
    // +∞ is ordered, so it lands on the last row and the last customer; −∞ on
    // the first of each. A finite index past the table still resolves to supper.
    expect(tierFor(Number.POSITIVE_INFINITY, 1)).toBe(3);
    expect(gapMsFor(SUPPER, Number.POSITIVE_INFINITY)).toBe(sec(2));
    expect(patienceMsFor(SUPPER, Number.POSITIVE_INFINITY)).toBe(sec(10));
    expect(tierFor(Number.NEGATIVE_INFINITY, 1)).toBe(1);
    expect(gapMsFor(BREAKFAST, Number.NEGATIVE_INFINITY)).toBe(sec(6));
    expect(patienceMsFor(SUPPER, Number.NEGATIVE_INFINITY)).toBe(sec(12));
    expect(tierFor(99, 1)).toBe(3);
    expect(gapMsFor(99, 1)).toBe(sec(3));
    expect(patienceMsFor(99, 1)).toBe(sec(12));
  });
});

/**
 * §10.4's single-source rule, mechanised.
 *
 * The banned values are built arithmetically from §8.5's seconds, so this file
 * does not itself contain the millisecond literals it forbids.
 *
 * **Scope: the surfaces §10.4 governs, and only those.** The scan reads
 * `src/game/**`, `src/dev/**`, `tests/game/**`, `tests/contract/**`,
 * `tests/dev/**` and `tests/support/**` — the game core, the harnesses that
 * hand-write game data, and the tests that assert on it. That is `SCOPE_ROOTS`
 * below.
 *
 * It used to read every text file under `src/` and `tests/` and exclude three
 * paths, and that was wider than the rule. §10.4 is about difficulty tuning
 * restated outside `config.ts`; every value it bans is also an ordinary number
 * somewhere else. Each of §8.5's millisecond forms is a plausible `z-index`, a
 * plausible animation duration in milliseconds, or a plausible SVG `viewBox`
 * extent, and the penalty fraction is a plausible `opacity` or `rgba()` alpha —
 * this file's own docstring tripped the scan while it was being written, and
 * S3.1-1 confirmed the rest by planting a banned `z-index` under
 * `src/components/` and a banned `opacity` under `src/styles/`. Under the old
 * scope a presentation sprint writing plain CSS reddened a test in
 * `tests/contract/**`, a directory only Sprint 3 declares and which that sprint
 * therefore has no legal way to edit. `src/app/**`, `src/components/**`,
 * `src/graphics/**`, `src/styles/**`, `src/storage/**`, `tests/presentation/**`
 * and `tests/styles/**` are consequently out of scope: a duration or a stacking
 * order there is a design-token question, not a §8 one.
 *
 * The three exclusions survive inside that narrower scope, each for a stated
 * reason rather than for convenience:
 *
 * - `src/game/config.ts` is the single source and is where they must appear.
 * - `tests/e2e/**` holds Playwright wall-clock budgets — how long a spec sits on
 *   a screen or waits for a transition. Those are test durations, not §8 tuning
 *   values, and forcing an observation window to read from the engine's config
 *   would couple a browser test to the difficulty curve.
 * - `tests/fixtures/**` — the whole directory, whatever the extension, matching
 *   `EXCLUDED` below. It holds §10.7's committed golden files, which are
 *   *recorded output* — regenerated when config is tuned, never hand-restated —
 *   and §10.4 excludes test fixtures by name.
 *
 * Neither `tests/e2e/` nor `tests/fixtures/` is under a scope root any more, so
 * both entries are now belt as well as braces. They stay because the reason for
 * each is a §10.4 reason, and a future root would otherwise re-admit them
 * silently.
 *
 * Hand-written fixture modules stay in scope: `src/dev/fixtures.ts` is what
 * S9-1 names this test as the guard for, so `src/dev/**` is a root and the
 * assertion below names that path directly rather than trusting the glob.
 */
describe('§10.4 single-source rule', () => {
  const BANNED_MS = [18, 16, 14, 12, 6, 5, 4, 3, 2.5, 2].map(sec);
  const PENALTY_FRACTION = 35 / 100;

  /**
   * Both patterns are assembled from the values rather than typed out, so this
   * file contains neither the millisecond forms nor the decimal form it hunts
   * for — otherwise the scan would report itself.
   */
  const msPattern = (value: number): RegExp => new RegExp(`(?<![\\w.])${value}(?![\\w.])`);
  const fractionPattern = (): RegExp =>
    new RegExp(`(?<![\\w.])0?[.]${String(PENALTY_FRACTION).slice(2)}(?![\\w])`);

  const TEXT_EXTENSIONS = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.css',
    '.json',
    '.html',
    '.svg',
  ];

  /** The surfaces §10.4 governs. See this describe's header for why these six. */
  const SCOPE_ROOTS = [
    join('src', 'game'),
    join('src', 'dev'),
    join('tests', 'game'),
    join('tests', 'contract'),
    join('tests', 'dev'),
    join('tests', 'support'),
  ];

  const EXCLUDED = [
    join('src', 'game', 'config.ts'),
    join('tests', 'e2e') + sep,
    join('tests', 'fixtures') + sep,
  ];

  /**
   * Whether a repo-relative path is one §10.4 governs. Split out from the walk
   * so the scope can be asserted for a file that does not exist yet — which is
   * the only way to hold `src/dev/fixtures.ts` before S9-1 writes it.
   */
  function inScope(file: string): boolean {
    if (!SCOPE_ROOTS.some((root) => file === root || file.startsWith(root + sep))) return false;
    return !EXCLUDED.some((excluded) => file === excluded || file.startsWith(excluded));
  }

  function textFilesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) {
        out.push(...textFilesUnder(rel));
      } else if (TEXT_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        out.push(rel);
      }
    }
    return out;
  }

  const files = SCOPE_ROOTS.flatMap((root) => textFilesUnder(root)).filter(inScope);

  it('scans a non-trivial file set, so it cannot pass by finding nothing', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).not.toContain(join('src', 'game', 'config.ts'));
    expect(files).toContain(join('src', 'game', 'view.ts'));
    expect(files).toContain(relative(ROOT, fileURLToPath(import.meta.url)));
  });

  it('has a real directory behind every scope root, so a rename cannot empty it', () => {
    // A root that stopped existing would throw in the walk rather than silently
    // contribute nothing — but a root spelled for a directory that never existed
    // would not, so it is named here too.
    for (const root of SCOPE_ROOTS) {
      expect(statSync(join(ROOT, root)).isDirectory(), root).toBe(true);
    }
  });

  it('keeps src/dev/fixtures.ts in scope, which S9-1 names this test as the guard for', () => {
    const fixtures = join('src', 'dev', 'fixtures.ts');
    expect(inScope(fixtures)).toBe(true);
    // S9-1 has not landed, so the file itself may not be there yet. Once it is,
    // being in scope is no longer enough — it has to be collected.
    if (existsSync(join(ROOT, fixtures))) {
      expect(files).toContain(fixtures);
    }
  });

  it('leaves the presentation surfaces out, which is the whole of the narrowing', () => {
    // Every path here is one a later sprint owns and this test must never red.
    // They are written as names rather than walked, because most do not exist
    // yet and the point is the scope rule, not today's tree.
    for (const outside of [
      join('src', 'app', 'App.tsx'),
      join('src', 'components', 'Cup.tsx'),
      join('src', 'components', 'Cup.module.css'),
      join('src', 'graphics', 'cup.svg'),
      join('src', 'styles', 'tokens.css'),
      join('src', 'storage', 'highscore.ts'),
      join('src', 'main.tsx'),
      join('tests', 'presentation', 'cup.test.ts'),
      join('tests', 'styles', 'tokens.test.ts'),
      join('tests', 'e2e', 'title.spec.ts'),
      join('tests', 'fixtures', 'golden.json'),
      join('src', 'game', 'config.ts'),
    ]) {
      expect(inScope(outside), outside).toBe(false);
    }
    // And nothing outside the roots got in by another door.
    expect(files.filter((file) => !inScope(file))).toEqual([]);
  });

  it('finds no §8.5 millisecond value outside src/game/config.ts', () => {
    const offences: string[] = [];

    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const value of BANNED_MS) {
        if (msPattern(value).test(source)) {
          offences.push(`${file}: ${value}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('finds the wrong-serve penalty fraction nowhere outside src/game/config.ts', () => {
    const offences = files.filter((file) =>
      fractionPattern().test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offences).toEqual([]);
  });

  it('bites: the same scan finds every banned value inside src/game/config.ts', () => {
    const source = readFileSync(join(ROOT, 'src', 'game', 'config.ts'), 'utf8');
    for (const value of BANNED_MS) {
      expect(msPattern(value).test(source), `${value} missing from config.ts`).toBe(true);
    }
    expect(fractionPattern().test(source)).toBe(true);
  });
});
