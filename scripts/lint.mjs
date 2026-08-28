#!/usr/bin/env node
/**
 * The `npm run lint` gate stage — S2-1 (Sprint 2 — ESLint 9, type-aware).
 *
 * This replaces Sprint 1's placeholder. The npm script stays
 * `node scripts/lint.mjs` forever; only this body changes, which is what let
 * Sprints 2 and 6 wire their tools concurrently without both opening
 * `package.json` (PRD §11.3).
 *
 * It runs the real linter over the whole tree with no warning budget: PRD
 * §10.7's gate is pass/fail, so a warning nobody reads is a failure nobody
 * reads. Extra arguments are forwarded, so `npm run lint -- --fix` works.
 *
 * It refuses to run vacuously in the other direction too: with no
 * `eslint.config.*` in the tree, `eslint .` would lint nothing and exit 0, so
 * this exits 1 instead of reporting a green gate over an unconfigured linter.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `.` rather than an explicit file list: the flat config owns which paths are
 * linted and which are ignored, so this script never has to be edited when a
 * sprint adds a directory.
 */
export const ESLINT_ARGS = Object.freeze(['.', '--max-warnings', '0']);

/** The `eslint` CLI, resolved through the package rather than a guessed path. */
function resolveEslintBin() {
  const manifestPath = require.resolve('eslint/package.json');
  const manifest = require('eslint/package.json');
  return resolve(dirname(manifestPath), manifest.bin.eslint);
}

function hasFlatConfig() {
  return readdirSync(root).some((name) => /^eslint\.config\.[cm]?[jt]s$/.test(name));
}

function main(extraArgs) {
  if (!hasFlatConfig()) {
    console.error(
      'lint: no eslint.config.* in the repo root, so `eslint .` would lint nothing ' +
        'and exit 0. Refusing to report a green gate over an unconfigured linter.',
    );
    return 1;
  }

  const bin = resolveEslintBin();
  if (!existsSync(bin)) {
    console.error('lint: the eslint CLI is missing. Run `npm ci`.');
    return 1;
  }

  const args = [...ESLINT_ARGS, ...extraArgs];
  console.log(`lint: eslint ${args.join(' ')}`);

  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    console.error(`lint: failed to start eslint — ${result.error.message}`);
    return 1;
  }
  // A signalled child reports a null status; treat that as a failure rather
  // than letting `process.exit(null)` become a 0.
  return result.status ?? 1;
}

/** Only run when invoked as the gate stage — the test imports `ESLINT_ARGS`. */
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
