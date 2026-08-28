#!/usr/bin/env node
/**
 * The `npm run e2e` gate stage (PRD §10.7), wired by S6-1.
 *
 * It lives in its own file so that the npm script stays `node scripts/e2e.mjs`
 * forever and no sprint has to reopen the shared `package.json`.
 *
 * The run is two stages over two *passes*, cheapest first.
 *
 * The stages:
 *
 *   1. **The Vitest half** — `tests/e2e/**\/*.test.ts`, the assertions about
 *      `playwright.config.ts` itself and about this script. No build, no
 *      browser, under a second. A base-path or projects-array regression fails
 *      here rather than after two minutes of Chromium. It needs its own Vitest
 *      config because the root one excludes `tests/e2e/**`, which it must:
 *      `npm run test` would otherwise try to run Playwright's `*.spec.ts` files
 *      as unit tests.
 *
 *   2. **The Playwright half** — `tests/e2e/**\/*.spec.ts` against a fresh
 *      `vite build` served by `vite preview` on the subpath the build resolved.
 *      `playwright.config.ts` owns the server, the port and the base URL.
 *
 * The passes exist because the base path is the thing this sprint guards, and
 * `GITHUB_REPOSITORY` is unset everywhere but GitHub Actions. Under a root base
 * path the guards in `tests/e2e/smoke.spec.ts` are vacuous — every same-origin
 * pathname starts with `/`, and there is no subpath to fail to redirect from.
 * So a green local run would say nothing at all about the deployed subpath. To
 * stop that, every invocation runs a **non-root probe pass** under a synthetic
 * `GITHUB_REPOSITORY` before the pass the caller actually asked for, and the
 * base-path specs skip loudly rather than pass silently when the base is root.
 * Both halves of the config — the build's `base` and the runner's `baseURL` —
 * come from `basePathFor`, so the probe moves them together exactly as a real
 * deploy does.
 *
 * `E2E_SKIP_BASE_PATH_PROBE=1` drops the probe pass for a faster inner loop.
 * Nothing in CI should set it: the probe is the pass that carries the sprint.
 *
 * Arguments are forwarded to Playwright, so `npm run e2e -- --headed --debug`
 * and `npm run e2e -- smoke` work as usual — to both passes.
 *
 * Chromium is the only browser this needs. If it cannot be launched the run
 * fails with the exact install command rather than a stack trace, because a
 * fresh checkout hits that before it hits anything else.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INSTALL_HINT = 'npx playwright install --with-deps chromium';

/** Playwright's own CLI, resolved from this project's dependencies. */
const PLAYWRIGHT_CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

/** Vitest's CLI, likewise — never a globally installed one. */
const VITEST_CLI = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

/**
 * The synthetic `<owner>/<repo>` the probe pass builds and serves under. It is
 * deliberately not this repository's name, nor any real one: `basePathFor` takes
 * the second segment, so the probe runs under `/base-path-probe/` and proves the
 * suite is pinned to no particular name (PRD §10.6).
 */
const PROBE_REPOSITORY = 'kopi-e2e/base-path-probe';

const VITEST_ARGS = ['run', '--config', join('tests', 'e2e', 'vitest.config.ts')];
const PLAYWRIGHT_ARGS = ['test', ...process.argv.slice(2)];

const PREFIX = 'e2e: ';

function fail(message) {
  const continuation = `\n${' '.repeat(PREFIX.length)}`;
  console.error(PREFIX + message.split('\n').join(continuation));
  process.exit(1);
}

function firstLine(error) {
  const text = String(error instanceof Error ? error.message : error);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return 'no detail reported';
}

/**
 * The passes, in the order they run. The probe goes first so that a base-path
 * regression — the class of bug this sprint exists to catch — reds the gate
 * before the pass that would pass anyway, and so that the `dist/` left behind
 * matches the environment the caller actually invoked.
 */
const passes = [];
if (process.env.E2E_SKIP_BASE_PATH_PROBE !== '1') {
  passes.push({
    label: `non-root base path (GITHUB_REPOSITORY=${PROBE_REPOSITORY})`,
    env: { GITHUB_REPOSITORY: PROBE_REPOSITORY },
  });
}
passes.push({ label: 'the base path this invocation resolves', env: {} });

function run(label, cli, args, env) {
  if (!existsSync(cli)) {
    fail(`${label} is not installed — run \`npm ci\` first (looked for ${cli}).`);
  }

  console.log(`\ne2e: ${label} — ${args.join(' ')}`);

  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  if (result.error) {
    fail(`could not start ${label}: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`${label} was killed by ${result.signal}.`);
  }
  if (result.status !== 0) {
    console.error(`\ne2e: ${label} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

/* Stage 1 — the config assertions, once per pass. `run` keeps Vitest out of
 * watch mode. Both passes go first because they are seconds against the browser
 * half's minutes, and because the assertions about the resolved base path are
 * worth making under a non-root base as well as a root one. */
for (const pass of passes) {
  run(`vitest — ${pass.label}`, VITEST_CLI, VITEST_ARGS, pass.env);
}

/*
 * Stage 2 — the browser suite, preceded by a look for the one browser it needs.
 * A fresh clone hits a missing Chromium before it hits anything else, and the
 * failure is worth one line of prose rather than a two-minute build followed by
 * a launch error.
 *
 * The check is a real headless launch, not a path test. Playwright's public API
 * offers only `chromium.executablePath()`, which names the full Chrome for
 * Testing build — but since Playwright 1.49 a headless `chromium` run launches
 * `chromium_headless_shell-*`, a separate download. Testing the wrong path lies
 * in both directions: it false-passes when only the headless shell is missing,
 * landing in precisely the stack trace this block exists to replace, and
 * false-fails a cache installed with `playwright install chromium-headless-shell`
 * alone. Launching is the only check expressible against the public API that
 * cannot be wrong about what the run will do — if it succeeds the suite can
 * launch, and if it fails the suite would have failed too. It costs well under
 * a second, against the build it precedes.
 *
 * Its scope, stated rather than implied: the launch is headless, so it covers
 * the gate's own invocation and not `npm run e2e -- --headed`, which launches
 * the full Chrome for Testing build instead. A headed run that finds the shell
 * present and the full build missing gets Playwright's own error, which names
 * the same install command. Guarding the case the gate never takes is not worth
 * a second browser launch on every run.
 *
 * If `@playwright/test` cannot even be imported we say nothing and let the CLI
 * stage speak for itself.
 */
let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  chromium = undefined;
}

if (chromium !== undefined) {
  try {
    const browser = await chromium.launch({ timeout: 60_000 });
    await browser.close();
  } catch (error) {
    fail(
      'Chromium could not be launched, so the browser suite cannot run.\n' +
        `Run \`${INSTALL_HINT}\`. No other browser is needed.\n` +
        `The launch reported: ${firstLine(error)}`,
    );
  }
}

for (const pass of passes) {
  run(`playwright (chromium) — ${pass.label}`, PLAYWRIGHT_CLI, PLAYWRIGHT_ARGS, pass.env);
}

const summary = passes.map((pass) => pass.label).join(' | ');
console.log(`\ne2e: green — config assertions and the chromium suite passed for: ${summary}.`);
