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
 * **Every exit path is either ESLint's own or an explicit non-zero refusal.**
 * There is deliberately no "am I the entry point?" guard. The first revision of
 * this file gated the run on `resolve(process.argv[1]) === fileURLToPath(
 * import.meta.url)` so that a test could import `ESLINT_ARGS` without linting.
 * Node realpaths the ESM entry point but not `argv[1]`, so under any symlinked
 * invocation path — `/tmp` → `/private/tmp` on macOS, a symlinked checkout, a
 * Docker bind mount, a CI workspace staged behind a link — the comparison was
 * false, the module fell off the end, and `npm run lint` exited 0 having linted
 * nothing. A silently green gate is the one failure this file exists to
 * prevent, so the guard is gone and the tests read the arguments off the banner
 * printed below instead of importing them.
 *
 * The two refusals, both non-zero and both loud:
 *   - no `eslint.config.*` in the tree — `eslint .` would lint nothing and exit
 *     0, so refuse rather than report green over an unconfigured linter;
 *   - the ESLint CLI cannot be resolved — say so in one line instead of
 *     surfacing a ten-frame `MODULE_NOT_FOUND` stack.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
const ESLINT_ARGS = ['.', '--max-warnings', '0'];

/**
 * The `eslint` CLI, resolved through the package rather than a guessed path, so
 * a non-flat `node_modules` layout still works. Returns `null` rather than
 * throwing, so the caller owns the message. npm's manifest permits `bin` as
 * either a bare string or an object, and both are handled.
 */
function resolveEslintBin() {
  let manifestPath;
  try {
    manifestPath = require.resolve('eslint/package.json');
  } catch {
    return null;
  }

  let bin;
  try {
    ({ bin } = JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    return null;
  }

  const relativeBin = typeof bin === 'string' ? bin : bin?.eslint;
  if (typeof relativeBin !== 'string') {
    return null;
  }
  return resolve(dirname(manifestPath), relativeBin);
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
  if (bin === null) {
    console.error('lint: the eslint CLI could not be resolved. Run `npm ci`.');
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

process.exit(main(process.argv.slice(2)));
