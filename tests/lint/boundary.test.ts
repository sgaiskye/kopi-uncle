import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * S7-3 (Sprint 7 — Boundary and purity lint).
 *
 * PRD §10.5: *"a rule that looks right and does nothing is worse than no
 * rule"*. Four files are committed deliberately broken and this test proves
 * each one trips the specific rule it was written to trip — asserted on the
 * `ruleId`, never on a message count, because a fixture that fails for an
 * unrelated reason proves nothing about the boundary.
 *
 * **Two traps are designed around here. Both are load-bearing.**
 *
 * 1. `eslint.config.js` globally ignores `tests/lint/fixtures/**`, which is what
 *    keeps `npm run lint` green over deliberately illegal files.
 *    `ESLint#lintFiles()` *skips* a globally-ignored path: it returns one
 *    "File ignored because of a matching ignore pattern" warning with a `null`
 *    `ruleId` and zero rule messages. Every assertion below would then fail on
 *    a default instance. The instance is therefore constructed with
 *    **`ignore: false`**, and `describe('the global ignore')` at the foot of
 *    this file pins that behaviour so the reason survives.
 *
 * 2. The fixtures are linted at their **real on-disk paths**. The overrides are
 *    path-glob scoped, so `lintText` under a synthetic filename outside the
 *    globs would report nothing and pass. `eslint.config.js` extends the two
 *    track globs to `tests/lint/fixtures/game-*` and
 *    `tests/lint/fixtures/component-*` for exactly this reason — which is also
 *    why renaming a fixture off that prefix would quietly disarm it.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = join(ROOT, 'tests', 'lint', 'fixtures');

/** The four fixtures §10.5 requires, and the rule each one exists to trip. */
const FIXTURES = {
  'game-imports-react.ts': 'no-restricted-imports',
  'component-imports-engine.tsx': 'no-restricted-imports',
  'game-uses-date-now.ts': 'no-restricted-syntax',
  'game-uses-set-timeout.ts': 'no-restricted-syntax',
} as const;

type FixtureName = keyof typeof FIXTURES;

const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

function fixturePath(name: FixtureName): string {
  return join(FIXTURE_DIR, name);
}

/**
 * A short-lived probe another sprint's test wrote, not a committed source.
 *
 * `tests/scaffold/lint-config.test.ts` (S2-1) writes `__lint-probe.generated.ts`
 * — a *deliberate* `no-floating-promises` violation — and a clean sibling into
 * `src/game/`, then removes them again. Used twice: to keep those probes out of
 * the negative control below, and to recognise them in a gate stage's failure
 * output (see `runScriptStably`).
 */
const GENERATED_PROBE = /\.generated\./u;

/**
 * The committed, compliant logic-track sources — the negative control.
 *
 * **Generated probes are excluded, and that is load-bearing.** Vitest runs test
 * files in parallel workers, so S2-1's write window overlaps this enumeration.
 * Including a probe would produce one of two false reds: the deliberate
 * violation reported against an assertion that says the file "is compliant and
 * must lint clean", or — if the probe is removed between `readdirSync` and
 * `lintFiles` — a hard throw, because `lintFiles` on a vanished explicit path
 * reports `No files matching '…' were found` rather than skipping it. Filtering
 * removes the race outright; the fixtures under test are all committed files
 * with known names, so nothing real is filtered out.
 *
 * Recursive, so the control does not silently narrow the day `src/game/` grows
 * a subdirectory. §10.2 keeps it flat today.
 */
function gameSources(): string[] {
  const dir = join(ROOT, 'src', 'game');
  // `encoding` is what pins the overload to `string[]`; without it the
  // recursive signature widens to `string[] | Buffer[]`.
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/u.test(name) && !GENERATED_PROBE.test(name))
    .map((name) => join(dir, name));
}

/** Messages keyed by absolute path, for one `lintFiles` run. */
type LintIndex = Map<string, ESLint.LintResult>;

async function lint(paths: string[], options: ESLint.Options): Promise<LintIndex> {
  const eslint = new ESLint({ cwd: ROOT, ...options });
  const index: LintIndex = new Map();
  for (const result of await eslint.lintFiles(paths)) {
    index.set(result.filePath, result);
  }
  return index;
}

function messagesFor(index: LintIndex, path: string): ESLint.LintResult['messages'] {
  const result = index.get(path);
  expect(result, `${path} was not linted at all — the config may be ignoring it`).toBeDefined();
  return result?.messages ?? [];
}

function ruleIdsFor(index: LintIndex, path: string): (string | null)[] {
  return messagesFor(index, path).map((message) => message.ruleId);
}

describe('the committed fixtures', () => {
  it('are exactly the four §10.5 names, and no more', () => {
    const present = readdirSync(FIXTURE_DIR)
      .filter((name) => name !== '.gitkeep')
      .sort();
    // Set equality both ways: a fifth fixture is as much a defect as a missing
    // one, because the count assertions below are what make fixture 3's
    // "three distinct violations" meaningful.
    expect(present).toEqual([...FIXTURE_NAMES].sort());
  });
});

describe('the rules bite on the fixtures', () => {
  let index: LintIndex;

  beforeAll(async () => {
    // `ignore: false` — see trap 1 in the header. Without it every assertion in
    // this block fails with an empty message list and a misleading cause.
    index = await lint(FIXTURE_NAMES.map(fixturePath), { ignore: false });
  }, 300_000);

  for (const name of FIXTURE_NAMES) {
    it(`reports ${FIXTURES[name]} on ${name}`, () => {
      const ruleIds = ruleIdsFor(index, fixturePath(name));
      expect(
        ruleIds,
        `${name} is committed to fail lint and did not. Rules reported: ${JSON.stringify(ruleIds)}`,
      ).toContain(FIXTURES[name]);
    });

    it(`parses ${name} — its failure is a rule, not a syntax error`, () => {
      // A fatal parse error also produces a non-empty message list, so without
      // this the assertion above could be satisfied by a broken fixture.
      const fatal = messagesFor(index, fixturePath(name)).filter((message) => message.fatal);
      expect(fatal.map((message) => message.message)).toEqual([]);
    });
  }

  it('reports all three banned member expressions on game-uses-date-now.ts', () => {
    const messages = messagesFor(index, fixturePath('game-uses-date-now.ts')).filter(
      (message) => message.ruleId === 'no-restricted-syntax',
    );
    expect(messages).toHaveLength(3);

    // One per banned expression, not three copies of the same selector: a
    // selector set that catches only `Date.now` must fail here.
    for (const expression of ['Date.now()', 'performance.now()', 'Math.random()']) {
      expect(
        messages.filter((message) => message.message.includes(expression)),
        `no message named ${expression}. §10.5: no-restricted-globals catches none of ` +
          'these three, so a selector per member expression is the mechanism.',
      ).toHaveLength(1);
    }
  });

  it('names the contract each fixture broke', () => {
    // §10.5 requires the message to tell the agent which contract it broke,
    // so the fix is obvious from the gate output alone.
    for (const name of ['game-imports-react.ts', 'component-imports-engine.tsx'] as const) {
      const messages = messagesFor(index, fixturePath(name)).filter(
        (message) => message.ruleId === 'no-restricted-imports',
      );
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.message).toContain('§10.5');
      }
    }

    for (const name of ['game-uses-date-now.ts', 'game-uses-set-timeout.ts'] as const) {
      const messages = messagesFor(index, fixturePath(name)).filter(
        (message) => message.ruleId === 'no-restricted-syntax',
      );
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.message).toContain('§3 constraint 7');
        expect(message.message).toContain('R20');
      }
    }
  });
});

describe('the negative control', () => {
  it('leaves the compliant sources under src/game/ alone', async () => {
    // Without this, a config that errored on every file under the two track
    // globs would pass every assertion above. These are real, committed,
    // §10.5-compliant logic-track modules.
    const paths = gameSources();
    expect(paths.length, 'src/game/ holds no sources to use as a control').toBeGreaterThan(0);

    const index = await lint(paths, { ignore: false });
    for (const path of paths) {
      expect(
        messagesFor(index, path).map((message) => `${String(message.ruleId)}: ${message.message}`),
        `${path} is compliant and must lint clean`,
      ).toEqual([]);
    }
  }, 300_000);
});

describe('the global ignore', () => {
  it('hides the fixtures from a default ESLint instance, ruleIds and all', async () => {
    // This is trap 1, pinned. It is *why* `ignore: false` is used above, and it
    // is simultaneously the proof of the last acceptance criterion: the
    // fixtures are outside `npm run lint`'s file set, which is what lets four
    // deliberately illegal files sit in the tree with the gate green.
    const eslint = new ESLint({ cwd: ROOT, warnIgnored: true });
    const results = await eslint.lintFiles(FIXTURE_NAMES.map(fixturePath));

    for (const result of results) {
      const ruleIds = result.messages.map((message) => message.ruleId);
      expect(
        ruleIds.filter((ruleId) => ruleId !== null),
        `${result.filePath} produced rule messages through the global ignore. If that ` +
          'is now true, the fixtures are inside `npm run lint`’s file set and the ' +
          'gate is red by construction.',
      ).toEqual([]);
    }
  }, 300_000);
});

/*
 * The last acceptance criterion, end to end: both gate stages stay green with
 * four deliberately illegal files committed. `eslint.config.js` keeps them out
 * of the linter's file set and `tsconfig.json`'s `exclude` keeps them out of
 * the compiler's, and the only assertion that can actually prove that is
 * running the two commands.
 */
type ScriptRun = SpawnSyncReturns<string>;

function runScript(script: string): ScriptRun {
  return spawnSync('npm', ['run', script], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * A `*.generated.*` path in the failure output is not this sprint's defect.
 *
 * `tests/scaffold/lint-config.test.ts` (S2-1) writes short-lived probe files
 * into `src/game/` and `src/app/` to prove the type-aware rules really fire,
 * and removes them again. Vitest runs test *files* in parallel workers, so a
 * whole-tree enumeration started here can list one of those probes and then
 * find it gone — ESLint reports `ENOENT` and exits non-zero over a tree that
 * is perfectly green.
 *
 * The two sprints are file-disjoint and neither is wrong, so the collision is
 * absorbed here rather than by editing a file this sprint does not own. Only a
 * failure naming a generated probe is retried — the pattern requires the
 * `.generated.` path segment and nothing else, so an unrelated `ENOENT` is not
 * retried through. A real violation fails on the first attempt, and a
 * persistent probe collision still fails the assertion rather than passing
 * quietly. Both failure texts that matter carry the path: ESLint's
 * `No files matching '…/src/game/__lint-probe.generated.ts' were found` and
 * `tsc`'s `ENOENT` both name the file they could not read.
 *
 * This is the same pattern `gameSources()` filters on, and deliberately so:
 * one definition of "another sprint's probe", used to exclude it from the
 * negative control and to recognise it in a gate stage's output.
 */

/**
 * Total attempts including the first, not the number of retries.
 *
 * Each attempt is a whole-tree `tsc` or `eslint` run nested inside
 * `npm run test`, so the cap is deliberately low: three runs is enough for a
 * probe window measured in milliseconds, and a collision that survives three
 * whole-tree passes is not transient.
 */
const MAX_ATTEMPTS = 3;

function runScriptStably(script: string): ScriptRun {
  let result = runScript(script);
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (result.status === 0 || !GENERATED_PROBE.test(`${result.stdout}${result.stderr}`)) {
      return result;
    }
    result = runScript(script);
  }
  return result;
}

describe('the gate stays green with illegal files committed', () => {
  it('npm run typecheck exits 0', () => {
    // tsconfig's `exclude` keeps the four fixtures out of the program; without
    // it, `component-imports-engine.tsx` alone would red the compiler.
    const result = runScriptStably('typecheck');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);

  it('npm run lint exits 0', () => {
    // The global `ignores` entry keeps them out of `eslint .`'s file set.
    const result = runScriptStably('lint');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);
});
