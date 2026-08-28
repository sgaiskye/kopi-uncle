#!/usr/bin/env node
/**
 * The `npm run e2e` gate stage (PRD §10.7), wired by S6-1.
 *
 * It lives in its own file so that the npm script stays `node scripts/e2e.mjs`
 * forever and no sprint has to reopen the shared `package.json`. Two stages run
 * in order, cheapest first:
 *
 *   1. **The Vitest half** — `tests/e2e/**\/*.test.ts`, the assertions about
 *      `playwright.config.ts` itself. No build, no browser, under a second. A
 *      base-path or projects-array regression fails here rather than after two
 *      minutes of Chromium. It needs its own Vitest config because the root one
 *      excludes `tests/e2e/**`, which it must: `npm run test` would otherwise
 *      try to run Playwright's `*.spec.ts` files as unit tests.
 *
 *   2. **The Playwright half** — `tests/e2e/**\/*.spec.ts` against a fresh
 *      `vite build` served by `vite preview` on the subpath the build resolved.
 *      `playwright.config.ts` owns the server, the port and the base URL.
 *
 * Arguments are forwarded to Playwright, so `npm run e2e -- --headed --debug`
 * and `npm run e2e -- smoke` work as usual.
 *
 * Chromium is the only browser this needs. If its binary is missing the run
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

function fail(message) {
  console.error(`e2e: ${message}`);
  process.exit(1);
}

function run(label, cli, args) {
  if (!existsSync(cli)) {
    fail(`${label} is not installed — run \`npm ci\` first (looked for ${cli}).`);
  }

  console.log(`\ne2e: ${label} — ${args.join(' ')}`);

  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
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

/* Stage 1 — the config assertions. `run` keeps Vitest out of watch mode. */
run('vitest (playwright config assertions)', VITEST_CLI, [
  'run',
  '--config',
  join('tests', 'e2e', 'vitest.config.ts'),
]);

/*
 * Stage 2 — the browser suite, preceded by a look for the one binary it needs.
 * A fresh clone hits a missing Chromium before it hits anything else, and the
 * failure is worth one line of prose rather than a two-minute build followed by
 * a launch error. If the path cannot be determined at all we say nothing and
 * let Playwright speak for itself.
 */
let chromiumPath;
try {
  const { chromium } = await import('@playwright/test');
  chromiumPath = chromium.executablePath();
} catch {
  chromiumPath = undefined;
}

if (chromiumPath !== undefined && !existsSync(chromiumPath)) {
  fail(
    `Chromium is not installed — expected it at ${chromiumPath}.\n` +
      `      Run \`${INSTALL_HINT}\`. No other browser is needed.`,
  );
}

run('playwright (chromium)', PLAYWRIGHT_CLI, ['test', ...process.argv.slice(2)]);

console.log('\ne2e: green — config assertions and the chromium suite both passed.');
