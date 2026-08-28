import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prettierFlat from 'eslint-config-prettier/flat';

/**
 * S2-1 (Sprint 2 — ESLint 9, type-aware).
 *
 * Every assertion here is about a property of *this* sprint's linter that must
 * hold for the life of the project: the flat config exists and is type-aware,
 * the rules actually fire rather than merely resolve, the gate stage cannot
 * report green without running ESLint, and the formatter is disarmed last so it
 * never fights the linter. Nothing here parses `docs/sprint.md`, and nothing
 * asserts that a later sprint leaves `eslint.config.js` untouched — Sprint 7
 * adds the §10.5 boundary and purity rules to the same file by design.
 *
 * Two kinds of test appear below, deliberately:
 *
 *   - `--print-config` reads prove a *severity resolves*. That is necessary and
 *     not sufficient: a `projectService` that silently fails to attach a
 *     program still prints a perfect config and then analyses nothing.
 *   - the ESLint Node API tests lint real files through the real config and
 *     assert real violations, which is the half that catches that.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONFIG_PATH = join(ROOT, 'eslint.config.js');
const LINT_SCRIPT = join(ROOT, 'scripts', 'lint.mjs');

const require = createRequire(import.meta.url);

interface PackageJson {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  bin?: string | Record<string, string>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const pkg = readJson<PackageJson>(join(ROOT, 'package.json'));

interface PackageLock {
  packages: Record<string, { version?: string } | undefined>;
}

const lock = readJson<PackageLock>(join(ROOT, 'package-lock.json'));

/**
 * The ESLint CLI, resolved exactly the way `scripts/lint.mjs` resolves it —
 * through the package manifest rather than a hardcoded
 * `node_modules/eslint/bin/eslint.js`. A hardcoded path under a non-flat
 * `node_modules` layout makes `spawnSync` fail with a null status, and the
 * assertion then reports `expected null to be 0` with empty output, which
 * hides a solvable cause behind a confusing message.
 */
function resolveEslintBin(): string {
  const manifestPath = require.resolve('eslint/package.json');
  const { bin } = readJson<PackageJson>(manifestPath);
  const relativeBin = typeof bin === 'string' ? bin : bin?.eslint;
  expect(relativeBin, `eslint's manifest declares no bin: ${manifestPath}`).toBeTypeOf('string');
  const resolved = join(dirname(manifestPath), relativeBin as string);
  expect(existsSync(resolved), `the eslint CLI is missing at ${resolved}. Run \`npm ci\`.`).toBe(
    true,
  );
  return resolved;
}

const ESLINT_BIN = resolveEslintBin();

/** One `--print-config` invocation, parsed. */
interface PrintedConfig {
  rules: Record<string, unknown[] | undefined>;
  languageOptions?: {
    parserOptions?: Record<string, unknown>;
  };
}

function printConfig(target: string): PrintedConfig {
  const result = spawnSync(process.execPath, [ESLINT_BIN, '--print-config', target], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(
    result.status,
    `eslint --print-config ${target} failed\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return JSON.parse(result.stdout) as PrintedConfig;
}

/**
 * A rule's severity as `--print-config` reports it: an array whose first
 * element is the numeric severity, 0 off / 1 warn / 2 error.
 */
function severityOf(printed: PrintedConfig, ruleId: string): number | undefined {
  const entry = printed.rules[ruleId];
  return Array.isArray(entry) ? (entry[0] as number) : undefined;
}

describe('the flat config', () => {
  it('exists at the repo root', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });

  it('has ESLint 9 as the installed major', () => {
    const installed = lock.packages['node_modules/eslint']?.version;
    expect(installed, 'eslint is missing from package-lock.json').toBeTruthy();
    expect(installed).toMatch(/^9\./);
  });
});

describe('the exported config array', () => {
  let config: unknown[];

  beforeAll(async () => {
    // Imported by URL rather than by specifier: `eslint.config.js` sits outside
    // tsconfig's `include`, so a literal import would not typecheck.
    const mod = (await import(pathToFileURL(CONFIG_PATH).href)) as { default: unknown[] };
    config = mod.default;
  });

  it('is an array of config objects', () => {
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(0);
    for (const entry of config) {
      expect(typeof entry).toBe('object');
      expect(entry).not.toBeNull();
    }
  });

  it('ends with eslint-config-prettier, so the formatter is disarmed last', () => {
    // Last wins in a flat config, so any stylistic rule an earlier entry turns
    // on is switched back off here and the linter never fights Prettier.
    const last = config.at(-1) as { name?: string; rules?: Record<string, unknown> };
    expect(last.name).toBe(prettierFlat.name);
    expect(last.rules).toEqual(prettierFlat.rules);
  });
});

describe('eslint-plugin-prettier', () => {
  it('is absent from the manifest', () => {
    expect(Object.keys(pkg.devDependencies)).not.toContain('eslint-plugin-prettier');
    expect(lock.packages['node_modules/eslint-plugin-prettier']).toBeUndefined();
  });

  it('is not installed — `npm ls` exits non-zero', () => {
    const result = spawnSync('npm', ['ls', 'eslint-plugin-prettier'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(
      result.status,
      'eslint-plugin-prettier is installed. Routing formatting through lint makes ' +
        'every reformat a gate failure with a stack trace attached (S2-1).',
    ).not.toBe(0);
  }, 120_000);
});

describe('typescript-eslint over src/game/', () => {
  let printed: PrintedConfig;

  beforeAll(() => {
    printed = printConfig('src/game/types.ts');
  });

  it('is configured type-aware', () => {
    const parserOptions = printed.languageOptions?.parserOptions ?? {};
    const typeAware =
      parserOptions.projectService !== undefined || parserOptions.project !== undefined;
    expect(
      typeAware,
      `neither projectService nor project is set: ${JSON.stringify(parserOptions)}`,
    ).toBe(true);
  });

  it('enables a rule that cannot exist without type information', () => {
    // no-floating-promises is decidable only with types, so its presence at
    // error proves the parser is *configured* with the program. That it really
    // has one is proved by lint-time behaviour further down.
    expect(severityOf(printed, '@typescript-eslint/no-floating-promises')).toBe(2);
  });
});

describe('react-hooks', () => {
  // `App.tsx` exists; `SlotRow.tsx` does not and is not expected to — it is a
  // probe for the `src/components/**` glob, and `--print-config` resolves a
  // path's config without requiring the file. Do not "fix" this by pointing it
  // at a real component: the point is that the glob covers the cluster
  // directories before a single component sprint has run.
  for (const target of ['src/app/App.tsx', 'src/components/slots/SlotRow.tsx']) {
    describe(target, () => {
      let printed: PrintedConfig;

      beforeAll(() => {
        printed = printConfig(target);
      });

      it('reports rules-of-hooks at error', () => {
        expect(severityOf(printed, 'react-hooks/rules-of-hooks')).toBe(2);
      });

      it('reports exhaustive-deps at error, not the plugin default of warn', () => {
        expect(severityOf(printed, 'react-hooks/exhaustive-deps')).toBe(2);
      });
    });
  }
});

/*
 * The rules are proven to fire, not merely to resolve.
 *
 * `--print-config` cannot see a `projectService` that resolves a config
 * perfectly and then fails to attach a program: that surfaces at lint time as a
 * type-aware rule reporting nothing. So these probes go through the ESLint Node
 * API against the real `eslint.config.js` and the real `tsconfig.json`, on real
 * paths under `src/`, because the config's globs and tsconfig's `include` are
 * both part of what is under test.
 *
 * The probes are written into the tree and removed again. Their content is
 * Prettier-clean so that a concurrent `prettier --check .` in
 * `tests/scaffold/formatting.test.ts` stays green while they exist, and their
 * names are generated-looking so a crashed run leaves an obvious artefact.
 * They are not committed and not placed under `tests/lint/fixtures/`, which
 * this config globally ignores and which S7-3 owns.
 */
const PROBES = {
  floatingPromise: {
    path: join(ROOT, 'src', 'game', '__lint-probe.generated.ts'),
    source: [
      '// Generated by tests/scaffold/lint-config.test.ts. Safe to delete.',
      'export function ready(): Promise<void> {',
      '  return Promise.resolve();',
      '}',
      '',
      'export function fire(): void {',
      '  ready();',
      '}',
      '',
    ].join('\n'),
  },
  conditionalHook: {
    path: join(ROOT, 'src', 'app', '__lint-probe.generated.tsx'),
    source: [
      '// Generated by tests/scaffold/lint-config.test.ts. Safe to delete.',
      "import { useState } from 'react';",
      '',
      'export function Probe({ on }: { on: boolean }) {',
      '  if (on) {',
      '    const [n] = useState(0);',
      '    return <p>{n}</p>;',
      '  }',
      '  return null;',
      '}',
      '',
    ].join('\n'),
  },
  compliant: {
    path: join(ROOT, 'src', 'game', '__lint-probe-clean.generated.ts'),
    source: [
      '// Generated by tests/scaffold/lint-config.test.ts. Safe to delete.',
      'export function ready(): Promise<void> {',
      '  return Promise.resolve();',
      '}',
      '',
      'export async function fire(): Promise<void> {',
      '  await ready();',
      '}',
      '',
    ].join('\n'),
  },
} as const;

describe('the rules bite', () => {
  const byPath = new Map<string, ESLint.LintResult>();

  function removeProbes(): void {
    for (const probe of Object.values(PROBES)) {
      rmSync(probe.path, { force: true });
    }
  }

  beforeAll(async () => {
    removeProbes();
    for (const probe of Object.values(PROBES)) {
      writeFileSync(probe.path, probe.source, 'utf8');
    }
    try {
      const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG_PATH });
      const results = await eslint.lintFiles(Object.values(PROBES).map((probe) => probe.path));
      for (const result of results) {
        byPath.set(result.filePath, result);
      }
    } finally {
      removeProbes();
    }
  }, 300_000);

  afterAll(() => {
    removeProbes();
  });

  function rulesFor(path: string): string[] {
    const result = byPath.get(path);
    expect(result, `${path} was not linted — the config may be ignoring it`).toBeDefined();
    return (result?.messages ?? []).map((message) => message.ruleId ?? '<fatal>');
  }

  it('reports a real no-floating-promises violation in src/game/', () => {
    // If `projectService` were resolving but not attaching a program, this rule
    // would report nothing and every --print-config assertion above would still
    // pass. This is the test that catches that.
    expect(rulesFor(PROBES.floatingPromise.path)).toContain(
      '@typescript-eslint/no-floating-promises',
    );
  });

  it('reports a real rules-of-hooks violation in src/app/', () => {
    expect(rulesFor(PROBES.conditionalHook.path)).toContain('react-hooks/rules-of-hooks');
  });

  it('leaves a compliant file alone — the rules are not firing on everything', () => {
    // The negative control. Without it, a config that errored on every file
    // would pass both assertions above.
    expect(rulesFor(PROBES.compliant.path)).toEqual([]);
  });
});

/*
 * The gate stage, end to end.
 *
 * Sprint 1's placeholder shipped three tests for its single guard, two of them
 * named "cannot be pointed away from its own directory to buy a green gate".
 * Those retired with the KOPI_SCAFFOLD_PLACEHOLDER marker, so the property they
 * defended — `npm run lint` never exits 0 without ESLint having run — is
 * re-established here against the real script.
 */

/**
 * A throwaway root holding a copy of `scripts/lint.mjs`. The script resolves
 * its own root from its own location and takes no override, so copying is the
 * only way to exercise its refusals without writing a broken state into the
 * working tree, where a crashed test would leave the gate red.
 *
 * `node_modules` is symlinked rather than installed, so the copy resolves the
 * same ESLint this repo does.
 */
interface TempRoot {
  path: string;
  cleanup: () => void;
}

const tempRoots: TempRoot[] = [];

function makeTempRoot(options: { config: boolean; nodeModules: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'kopi-lint-stage-'));
  tempRoots.push({ path: root, cleanup: () => rmSync(root, { recursive: true, force: true }) });

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(LINT_SCRIPT, join(root, 'scripts', 'lint.mjs'));
  writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n', 'utf8');

  if (options.nodeModules) {
    symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  }

  if (options.config) {
    // One warn-level rule and one file that trips it. `--max-warnings 0` is the
    // only reason this should fail, which is what makes the exit code a
    // behavioural assertion about that flag rather than about the tree.
    writeFileSync(
      join(root, 'eslint.config.js'),
      "export default [{ files: ['probe.js'], rules: { 'no-unused-vars': 'warn' } }];\n",
      'utf8',
    );
    writeFileSync(join(root, 'probe.js'), 'const unused = 1;\n', 'utf8');
  }

  return root;
}

function runStage(root: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'lint.mjs'), ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

afterAll(() => {
  for (const root of tempRoots) {
    root.cleanup();
  }
});

describe('the lint gate stage', () => {
  it('no longer carries the scaffold placeholder marker', () => {
    const source = readFileSync(LINT_SCRIPT, 'utf8');
    expect(
      source,
      'the placeholder marker retires the scaffold assertions about placeholder ' +
        'behaviour; leaving it in place would claim this file is still a stub',
    ).not.toContain('KOPI_SCAFFOLD_PLACEHOLDER');
  });

  it('runs clean over the current tree, and says what it ran', () => {
    const result = spawnSync(process.execPath, [LINT_SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    // The banner is the contract AC 5 names: `eslint .` with `--max-warnings 0`.
    expect(result.stdout).toContain('lint: eslint . --max-warnings 0');
  }, 300_000);

  it('keeps format:check on Prettier alone', () => {
    expect(pkg.scripts['format:check']).toBe('prettier --check .');
  });
});

describe('the lint gate stage, invoked through a symlinked path', () => {
  let real: string;
  let linked: string;

  beforeAll(() => {
    real = makeTempRoot({ config: true, nodeModules: true });
    const linkParent = mkdtempSync(join(tmpdir(), 'kopi-lint-link-'));
    tempRoots.push({
      path: linkParent,
      cleanup: () => rmSync(linkParent, { recursive: true, force: true }),
    });
    linked = join(linkParent, 'link');
    symlinkSync(real, linked, 'dir');
  });

  it('fails on the warning tripwire when invoked by its canonical path', () => {
    const result = runStage(real);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stdout).toContain('lint: eslint . --max-warnings 0');
  }, 120_000);

  it('still lints — and still fails — when invoked through the symlink', () => {
    const result = runStage(linked);
    expect(
      result.status,
      'the stage exited 0 through a symlinked path. It linted nothing: this is the ' +
        'silently green gate the entry-point guard used to produce.\n' +
        `${result.stdout}\n${result.stderr}`,
    ).toBe(1);
    expect(result.stdout).toContain('lint: eslint . --max-warnings 0');
  }, 120_000);
});

describe('the lint gate stage refusals', () => {
  it('enforces --max-warnings 0, and forwards extra arguments that relax it', () => {
    const root = makeTempRoot({ config: true, nodeModules: true });

    // One warning, no errors: non-zero only because of `--max-warnings 0`.
    expect(runStage(root).status, 'the --max-warnings 0 budget did not reach eslint').toBe(1);

    // Extra arguments are appended *after* the defaults, and ESLint's CLI takes
    // the last occurrence of a flag — so raising the budget from the command
    // line flips the same tree to green. That is only observable if extra
    // arguments really reach ESLint, which is what makes `npm run lint -- --fix`
    // work.
    const relaxed = runStage(root, ['--max-warnings', '5']);
    expect(
      relaxed.status,
      `extra arguments are not forwarded to eslint\n${relaxed.stdout}\n${relaxed.stderr}`,
    ).toBe(0);
    expect(relaxed.stdout).toContain('--max-warnings 0 --max-warnings 5');
  }, 120_000);

  it('refuses to exit 0 with no eslint.config.* present', () => {
    // `eslint .` over an unconfigured tree lints nothing and exits 0. Reporting
    // that as a green gate is the mirror of the lie Sprint 1's placeholder
    // refused to tell once a config appeared.
    const result = runStage(makeTempRoot({ config: false, nodeModules: true }));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stderr).toContain('eslint.config');
  }, 120_000);

  it('reports an unresolvable eslint CLI in one line rather than a stack trace', () => {
    const result = runStage(makeTempRoot({ config: true, nodeModules: false }));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stderr).toContain('npm ci');
    expect(
      result.stderr,
      'the resolve failure escaped as an exception instead of the intended message',
    ).not.toContain('MODULE_NOT_FOUND');
  }, 120_000);
});
