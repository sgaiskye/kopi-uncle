import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * S7-1 and S7-2 (Sprint 7 — Boundary and purity lint).
 *
 * `tests/lint/boundary.test.ts` proves the four committed fixtures trip the two
 * rules. This file covers the parts of §10.5's seam no fixture can reach:
 *
 *   - the *whole* ban list, including `graphics/`, `dev/` and `storage/`, which
 *     hold no modules yet and so cannot be imported by a committed fixture;
 *   - `src/app/EngineContext.tsx` being the single permitted importer of either
 *     engine implementation — the file lands in Sprint 13 and does not exist
 *     yet, so the exemption is asserted through the resolved configuration
 *     rather than by linting it;
 *   - the tree-wide grep S7-1 requires, which is what stops that exemption
 *     from quietly widening to a second file as the presentation track fills in;
 *   - the mechanism assertion of S7-2: the three member expressions are banned
 *     by AST selectors and not by `no-restricted-globals`, which §10.5 rules
 *     out because it would match none of them.
 *
 * The behavioural probes go through `lintText` at a path that **does** match
 * `src/game/**` / `src/components/**` — the glob scoping is the thing under
 * test, so a synthetic path outside it would pass and prove nothing. Nothing is
 * written to disk: `npm run test` runs `tsc --noEmit` over the tree in
 * `tests/contract/typecheck.test.ts`, and a temporary file under `src/`
 * importing modules that do not exist yet would race it red.
 *
 * The one concession the probes make is `disableTypeChecked` over the probe
 * path. `projectService` has no program for a file that is not on disk and
 * would report a fatal parse error instead of a rule message. Neither rule
 * under test needs type information — both are purely syntactic — and the path
 * globs, which are what is actually being tested, are untouched.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONFIG_PATH = join(ROOT, 'eslint.config.js');

/** §10.5's one indirection. Sprint 13 creates it; the exemption exists now. */
const ENGINE_INDIRECTION = 'src/app/EngineContext.tsx';

const PROBE_GLOB = '**/__seam-probe.generated.{ts,tsx}';

interface NamedConfig {
  name?: string;
  files?: (string | string[])[];
  rules?: Record<string, unknown>;
}

/** One entry of the flat-config array, by its `name`. */
function blockNamed(config: NamedConfig[], name: string): NamedConfig {
  const found = config.filter((entry) => entry.name === name);
  expect(found, `no flat-config block named ${name}`).toHaveLength(1);
  return found[0];
}

/**
 * The probe linter. `overrideConfig` is appended after `eslint.config.js`, so
 * everything the real config says about `src/game/**` and `src/components/**`
 * still applies to the probe paths.
 */
function probeLinter(): ESLint {
  return new ESLint({
    cwd: ROOT,
    ignore: false,
    overrideConfig: [
      { ...tseslint.configs.disableTypeChecked, files: [PROBE_GLOB] },
    ] as ESLint.Options['overrideConfig'],
  });
}

async function probe(relativePath: string, lines: string[]): Promise<ESLint.LintResult> {
  const [result] = await probeLinter().lintText(`${lines.join('\n')}\n`, {
    filePath: join(ROOT, relativePath),
  });
  const fatal = result.messages.filter((message) => message.fatal);
  expect(
    fatal.map((message) => message.message),
    `${relativePath} failed to parse`,
  ).toEqual([]);
  return result;
}

/**
 * `no-restricted-imports`' severity as `calculateConfigForFile` reports it —
 * 0 off, 2 error — read off the first element of the rule's option array.
 */
function severityOf(config: NamedConfig): number | undefined {
  const entry = config.rules?.['no-restricted-imports'];
  return Array.isArray(entry) ? (entry[0] as number) : undefined;
}

/** The import specifiers a probe had reported against it, deduplicated. */
function restrictedSources(result: ESLint.LintResult): string[] {
  const sources = new Set<string>();
  for (const message of result.messages) {
    if (message.ruleId !== 'no-restricted-imports') {
      continue;
    }
    const match = /^'(?<source>[^']+)' import is restricted/u.exec(message.message);
    expect(match, `unrecognised no-restricted-imports message: ${message.message}`).not.toBeNull();
    sources.add(match?.groups?.source ?? '');
  }
  return [...sources].sort();
}

describe('S7-1 — the logic track imports nothing from the presentation track', () => {
  let sources: string[];

  beforeAll(async () => {
    const result = await probe('src/game/__seam-probe.generated.ts', [
      "import { useState } from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import { SlotRow } from '../components/slots/SlotRow';",
      "import { Cup } from '../graphics/Cup';",
      "import { App } from '../app/App';",
      "import { stubEngine } from '../dev/stubEngine';",
      "import { load } from '../storage/local';",
      "import tokens from '../styles/tokens.css';",
      "import shell from './Shell.module.css';",
      "import { tick } from './engine';",
      // Legal, and here on purpose: a rule that fired on the seam itself would
      // make `src/game/` unable to import its own contract.
      "import type { Drink } from './types';",
      "import { formatOrder } from './view';",
      'export const probe = {',
      '  useState,',
      '  createRoot,',
      '  SlotRow,',
      '  Cup,',
      '  App,',
      '  stubEngine,',
      '  load,',
      '  tokens,',
      '  shell,',
      '  tick,',
      '  formatOrder,',
      '};',
      'export type ProbeDrink = Drink;',
    ]);
    sources = restrictedSources(result);
  }, 300_000);

  const BANNED: Record<string, string> = {
    react: 'react',
    'react-dom': 'react-dom/client',
    'src/components/*': '../components/slots/SlotRow',
    'src/graphics/*': '../graphics/Cup',
    'src/app/*': '../app/App',
    'src/dev/*': '../dev/stubEngine',
    'src/storage/*': '../storage/local',
    'a plain stylesheet': '../styles/tokens.css',
    'a CSS module': './Shell.module.css',
    // The probe imported `./engine` from the start; nothing asserted it until a
    // mutation test showed the sibling engine forms could be deleted from the
    // config with every test in `tests/lint/` still green. §10.5's whole point
    // is that `src/game/` cannot reach its own engine except through
    // `EngineContext.tsx`, so the relative spelling is the one that matters
    // most here.
    'the engine, relatively': './engine',
  };

  for (const [label, specifier] of Object.entries(BANNED)) {
    it(`bans ${label}`, () => {
      expect(sources, `${specifier} was not reported`).toContain(specifier);
    });
  }

  it('leaves the seam itself importable — types and view are not reported', () => {
    // The negative control for this probe. Without it, a config that banned
    // every import from `src/game/` would satisfy all nine assertions above.
    expect(sources).not.toContain('./types');
    expect(sources).not.toContain('./view');
  });
});

describe('S7-1 — the presentation track sees only types and view', () => {
  let sources: string[];

  beforeAll(async () => {
    const result = await probe('src/components/slots/__seam-probe.generated.tsx', [
      "import type { GameState } from '../../game/types';",
      "import { formatOrder } from '../../game/view';",
      "import { tick } from '../../game/engine';",
      // A module M1a adds later: the ban is on everything under `game/`, not on
      // a list of today's filenames, so a file that does not exist yet is still
      // denied.
      "import { grammar } from '../../game/grammar';",
      "import { stubEngine } from '../../dev/stubEngine';",
      'export const probe = { formatOrder, tick, grammar, stubEngine };',
      'export type ProbeState = GameState;',
    ]);
    sources = restrictedSources(result);
  }, 300_000);

  it('bans the engine', () => {
    expect(sources).toContain('../../game/engine');
  });

  it('bans the stub engine', () => {
    expect(sources).toContain('../../dev/stubEngine');
  });

  it('bans a logic module that does not exist yet', () => {
    expect(sources).toContain('../../game/grammar');
  });

  it('permits exactly the two seam modules', () => {
    // §10.5's three-part seam minus the engine signatures. If either of these
    // were reported the presentation track could not render an order at all.
    expect(sources).not.toContain('../../game/types');
    expect(sources).not.toContain('../../game/view');
  });
});

describe('S7-1 — EngineContext is the only permitted importer', () => {
  it('turns the restriction off for that one path, and for no other', async () => {
    // `EngineContext.tsx` lands in Sprint 13. `calculateConfigForFile` resolves
    // a path's configuration without the file existing, which is the only way
    // to assert the exemption now — and writing a placeholder into `src/app/`
    // to lint instead would race `tsc --noEmit` in the same `npm run test`.
    const eslint = new ESLint({ cwd: ROOT, ignore: false });

    const permitted = (await eslint.calculateConfigForFile(
      join(ROOT, ENGINE_INDIRECTION),
    )) as NamedConfig;
    const denied = (await eslint.calculateConfigForFile(
      join(ROOT, 'src/app/GameScreen.tsx'),
    )) as NamedConfig;

    // `calculateConfigForFile` keeps a disabled rule in the map with severity
    // 0 rather than dropping it, so the assertion is on the severity.
    expect(severityOf(permitted), `${ENGINE_INDIRECTION} is not exempt`).toBe(0);
    expect(
      severityOf(denied),
      'the exemption has widened past EngineContext.tsx — every other module under ' +
        'src/ must be denied (§10.5)',
    ).toBe(2);
  }, 300_000);

  it('denies the engine to a sibling screen', async () => {
    const result = await probe('src/app/__seam-probe.generated.tsx', [
      "import { tick } from '../game/engine';",
      "import { stubEngine } from '../dev/stubEngine';",
      'export const probe = { tick, stubEngine };',
    ]);
    expect(restrictedSources(result)).toEqual(['../dev/stubEngine', '../game/engine']);
  }, 300_000);
});

/*
 * The relative spellings, which are the ones a real caller reaches for.
 *
 * `no-restricted-imports` matches the specifier as written and never resolves
 * it, so a ban is only as good as the spellings it covers. An earlier revision
 * of `eslint.config.js` covered the directory-qualified form and the sibling
 * form but not the *parent* form, which left `src/dev/gallery/Foo.tsx`
 * importing `'../stubEngine'` linting clean — and PRD §10.2 ships
 * `src/dev/gallery/` as a sibling of `src/dev/stubEngine.ts`, so that is the
 * natural spelling from the likeliest caller. The tree-wide grep below would
 * have caught such an import after the fact; §10.5's mitigation is that the
 * *linter* tells the agent at edit time.
 *
 * Every one of `ENGINE_GROUP`'s four patterns is covered here: deleting any of
 * them reddens at least one assertion in this block.
 */
describe('S7-1 — the engine is denied in every relative spelling', () => {
  it('denies the parent form from a sibling directory of the stub engine', async () => {
    const result = await probe('src/dev/gallery/__seam-probe.generated.tsx', [
      "import { stubEngine } from '../stubEngine';",
      // The extensioned spelling — Node-style ESM resolution writes `.js` even
      // for a TypeScript source, so it is not exotic.
      "import { reset } from '../stubEngine.js';",
      "import { create } from '../../dev/stubEngine';",
      // Legal, and here on purpose: §10.5 has Track B render `src/dev/fixtures`,
      // so a ban broadened to the whole of `dev/` would break the gallery this
      // probe stands in for.
      "import { drinks } from '../fixtures';",
      'export const probe = { stubEngine, reset, create, drinks };',
    ]);

    const sources = restrictedSources(result);
    expect(sources, 'the parent form of the stub engine is not denied').toContain('../stubEngine');
    expect(sources, 'the extensioned parent form is not denied').toContain('../stubEngine.js');
    expect(sources).toContain('../../dev/stubEngine');
    expect(
      sources,
      'PRD §10.5 has Track B render `src/dev/fixtures`; the engine ban must not reach it',
    ).not.toContain('../fixtures');
  }, 300_000);

  it('denies the parent form from a subdirectory of the logic track', async () => {
    const result = await probe('src/game/sub/__seam-probe.generated.ts', [
      "import { tick } from '../engine';",
      "import { create } from '../engine.js';",
      // The seam itself, from the same depth: still importable.
      "import type { GameState } from '../types';",
      'export const probe = { tick, create };',
      'export type ProbeState = GameState;',
    ]);

    const sources = restrictedSources(result);
    expect(sources, 'the parent form of the engine is not denied').toContain('../engine');
    expect(sources, 'the extensioned parent form is not denied').toContain('../engine.js');
    expect(sources).not.toContain('../types');
  }, 300_000);
});

/*
 * The tree-wide grep S7-1 requires. Lint enforces the rule going forward; this
 * asserts the property holds over the tree as it stands, including any file a
 * future config edit might accidentally scope out of the rule.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, found);
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

/** `from '…'`, `import('…')` and bare `import '…'`, in that order. */
const SPECIFIER_PATTERN =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/gu;

/** Matches either engine implementation, with or without a file extension. */
const ENGINE_MODULE = /(?:^|\/)(?:engine|stubEngine)(?:\.[cm]?tsx?)?$/u;

describe('S7-1 — the tree agrees with the config', () => {
  it('has no importer of the engine or the stub outside EngineContext.tsx', () => {
    const importers: string[] = [];

    for (const path of sourceFiles(join(ROOT, 'src'))) {
      const source = readFileSync(path, 'utf8');
      SPECIFIER_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SPECIFIER_PATTERN.exec(source)) !== null) {
        const specifier = match[1] ?? match[2] ?? match[3] ?? '';
        if (ENGINE_MODULE.test(specifier)) {
          importers.push(`${relative(ROOT, path).split(sep).join('/')} → ${specifier}`);
        }
      }
    }

    const offenders = importers.filter((entry) => !entry.startsWith(`${ENGINE_INDIRECTION} →`));
    expect(
      offenders,
      'PRD §10.5: `src/app/EngineContext.tsx` is the only module that may name ' +
        '`src/game/engine` or `src/dev/stubEngine`, so M2 swapping the stub for the ' +
        'engine stays a one-file change.',
    ).toEqual([]);
  });
});

describe('S7-2 — the purity ban is AST selectors, not restricted globals', () => {
  let config: NamedConfig[];

  beforeAll(async () => {
    // Imported by URL: `eslint.config.js` is outside tsconfig's `include`, so a
    // literal import specifier would not typecheck.
    const module = (await import(pathToFileURL(CONFIG_PATH).href)) as { default: NamedConfig[] };
    config = module.default;
  });

  it('scopes the purity block to src/game/** and the game-* fixtures', () => {
    const block = blockNamed(config, 'kopi/game-boundary');
    const files = (block.files ?? []).flat();
    expect(files).toContain('src/game/**/*.{ts,tsx}');
    // The fixture glob is what makes S7-3's committed fixtures live proof; drop
    // it and the fixtures silently pass.
    expect(files).toContain('tests/lint/fixtures/game-*.{ts,tsx}');
  });

  it('scopes the presentation seam to the two tracks and the component-* fixtures', () => {
    // The mirror of the assertion above. Both fixture globs are equally
    // load-bearing — `component-imports-engine.tsx` only proves anything
    // because `kopi/presentation-seam` reaches its real on-disk path.
    const block = blockNamed(config, 'kopi/presentation-seam');
    const files = (block.files ?? []).flat();
    expect(files).toContain('src/components/**/*.{ts,tsx}');
    expect(files).toContain('src/graphics/**/*.{ts,tsx}');
    expect(files).toContain('tests/lint/fixtures/component-*.{ts,tsx}');
  });

  it('bans the three member expressions with CallExpression > MemberExpression selectors', () => {
    const block = blockNamed(config, 'kopi/game-boundary');
    const entries = (block.rules?.['no-restricted-syntax'] as unknown[]).slice(1) as {
      selector: string;
      message: string;
    }[];

    for (const [object, property] of [
      ['Date', 'now'],
      ['performance', 'now'],
      ['Math', 'random'],
    ]) {
      const matching = entries.filter(
        (entry) =>
          /CallExpression\s*>\s*MemberExpression/u.test(entry.selector) &&
          entry.selector.includes(`'${object}'`) &&
          entry.selector.includes(`'${property}'`),
      );
      expect(
        matching,
        `no CallExpression > MemberExpression selector for ${object}.${property}()`,
      ).toHaveLength(1);
    }
  });

  it('bans the three schedulers as identifiers', () => {
    const block = blockNamed(config, 'kopi/game-boundary');
    const entries = (block.rules?.['no-restricted-syntax'] as unknown[]).slice(1) as {
      selector: string;
    }[];

    for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
      expect(
        entries.filter((entry) => entry.selector === `Identifier[name='${name}']`),
        `no identifier selector for ${name}`,
      ).toHaveLength(1);
    }
  });

  it('names §3 constraint 7 and R20 in every selector message', () => {
    const block = blockNamed(config, 'kopi/game-boundary');
    const entries = (block.rules?.['no-restricted-syntax'] as unknown[]).slice(1) as {
      message: string;
    }[];
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const entry of entries) {
      expect(entry.message).toContain('§3 constraint 7');
      expect(entry.message).toContain('R20');
      expect(entry.message).toContain('dtMs');
      expect(entry.message).toContain('rngState');
    }
  });

  it('never reaches for no-restricted-globals anywhere in the config', () => {
    // §10.5 rules it out explicitly: `Date.now()`, `performance.now()` and
    // `Math.random()` are member expressions, so that rule would catch only
    // `setTimeout` and report a green gate over all three.
    for (const block of config) {
      expect(
        Object.keys(block.rules ?? {}),
        `${block.name ?? '<unnamed>'} configures no-restricted-globals`,
      ).not.toContain('no-restricted-globals');
    }
    expect(readFileSync(CONFIG_PATH, 'utf8')).not.toContain("'no-restricted-globals'");
  });

  it('names §10.5 in every import restriction', () => {
    for (const name of [
      'kopi/engine-indirection',
      'kopi/game-boundary',
      'kopi/presentation-seam',
    ]) {
      const block = blockNamed(config, name);
      const [, options] = block.rules?.['no-restricted-imports'] as [
        string,
        { patterns: { message: string }[] },
      ];
      expect(options.patterns.length).toBeGreaterThan(0);
      for (const pattern of options.patterns) {
        expect(pattern.message, `a pattern in ${name} does not name §10.5`).toContain('§10.5');
      }
    }
  });
});
