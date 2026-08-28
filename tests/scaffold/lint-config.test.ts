import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import prettierFlat from 'eslint-config-prettier/flat';

/**
 * S2-1 (Sprint 2 — ESLint 9, type-aware).
 *
 * Every assertion here is about a property of *this* sprint's linter that must
 * hold for the life of the project: the flat config exists and is type-aware,
 * the React hook rules bite where React lives, and the formatter is disarmed
 * last so it never fights the linter. Nothing here parses `docs/sprint.md`, and
 * nothing asserts that a later sprint leaves `eslint.config.js` untouched —
 * Sprint 7 adds the §10.5 boundary and purity rules to the same file by design.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONFIG_PATH = join(ROOT, 'eslint.config.js');
const ESLINT_BIN = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

interface PackageJson {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8'),
) as PackageJson;

interface PackageLock {
  packages: Record<string, { version?: string } | undefined>;
}

const lock: PackageLock = JSON.parse(
  readFileSync(join(ROOT, 'package-lock.json'), 'utf8'),
) as PackageLock;

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
    // error proves the parser really has the program and not just the AST.
    expect(severityOf(printed, '@typescript-eslint/no-floating-promises')).toBe(2);
  });
});

describe('react-hooks', () => {
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

describe('the lint gate stage', () => {
  it('no longer carries the scaffold placeholder marker', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'lint.mjs'), 'utf8');
    expect(
      source,
      'the placeholder marker retires the scaffold assertions about placeholder ' +
        'behaviour; leaving it in place would claim this file is still a stub',
    ).not.toContain('KOPI_SCAFFOLD_PLACEHOLDER');
  });

  it('invokes eslint over the whole tree with no warning budget', async () => {
    const mod = (await import(pathToFileURL(join(ROOT, 'scripts', 'lint.mjs')).href)) as {
      ESLINT_ARGS: readonly string[];
    };
    expect(mod.ESLINT_ARGS).toContain('.');
    // PRD §10.7's gate treats a warning as a failure, so the linter must too.
    expect(mod.ESLINT_ARGS.join(' ')).toContain('--max-warnings 0');
  });

  it('runs clean over the current tree', () => {
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'lint.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);

  it('keeps format:check on Prettier alone', () => {
    expect(pkg.scripts['format:check']).toBe('prettier --check .');
  });
});
