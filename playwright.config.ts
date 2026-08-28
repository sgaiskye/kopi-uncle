import { defineConfig } from '@playwright/test';

import { basePathFor } from './vite.config';

/**
 * S6-1 — the `npm run e2e` gate stage (PRD §10.7), driven by `scripts/e2e.mjs`.
 *
 * Two decisions carry the sprint:
 *
 * 1. **The suite runs against the built app, never the dev server.** `vite dev`
 *    serves from `/` regardless of `base`, so a base-path regression is exactly
 *    the class of bug it cannot see. `webServer` builds and then previews.
 *
 * 2. **The subpath is derived, never written down.** `basePathFor` is the same
 *    function `vite.config.ts` feeds to `base` (PRD §10.6), called on the same
 *    `GITHUB_REPOSITORY`, so the runner and the build can never disagree about
 *    where the app lives. Setting `GITHUB_REPOSITORY=acme/demo` moves both to
 *    `/demo/` together and the suite still passes — which is the proof that a
 *    fork, a rename or a clone under any name deploys unchanged.
 *
 * Because `GITHUB_REPOSITORY` is unset everywhere but GitHub Actions, this
 * config resolves to `/` on every developer machine, where the base-path
 * assertions have nothing to bite on. `scripts/e2e.mjs` therefore runs the
 * suite twice — once under a synthetic non-root `GITHUB_REPOSITORY` and once as
 * invoked — so the non-root case is part of the gate rather than a habit.
 *
 * Chromium only, on purpose: `npx playwright install --with-deps chromium` is
 * the whole browser dependency, and `tests/e2e/playwright-config.test.ts`
 * asserts nothing here quietly grows a second engine.
 */

/** The subpath the Vite build resolved. Always starts and ends with `/`. */
export const E2E_BASE_PATH = basePathFor(process.env.GITHUB_REPOSITORY);

/**
 * Fixed and strict, and precise about what that buys.
 *
 * `--strictPort` constrains only the server *this config starts*: it binds this
 * exact port or exits, rather than drifting to 4318 and leaving the runner
 * pointed at whatever holds 4317. It does **not** stop `reuseExistingServer`
 * from attaching to a server someone else started on this port — on that path
 * the `npm run build` half of `command` never runs at all, so a `dist/` from an
 * older commit, or one built under a different base, is reachable by a local
 * gate run. `reuseExistingServer: !process.env.CI` is deliberate (it is what
 * makes an inner loop bearable) and CI never takes that path.
 *
 * The protection against a wrong-base bundle is therefore not the port; it is
 * the assertions in `tests/e2e/smoke.spec.ts`, which check where the app's own
 * requests actually resolve, plus the non-root probe pass `scripts/e2e.mjs`
 * runs so those assertions are never vacuous.
 */
export const E2E_PREVIEW_PORT = 4317;

/** Where the built app actually answers, subpath included. */
export const E2E_BASE_URL = `http://localhost:${E2E_PREVIEW_PORT}${E2E_BASE_PATH}`;

export default defineConfig({
  testDir: 'tests/e2e',

  /**
   * Specs only. `tests/e2e/` also holds the Vitest assertions about this file,
   * and Playwright must not try to run those as browser tests.
   */
  testMatch: '**/*.spec.ts',

  /* Both already in .gitignore, so a failed run leaves no untracked noise. */
  outputDir: 'test-results',
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  /* A `.only` left behind must red CI rather than quietly skip the suite. */
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  /* One preview server on one strict port — parallel workers would contend. */
  workers: 1,
  fullyParallel: false,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    /**
     * Ends with the resolved subpath, so every spec navigates relatively —
     * `page.goto('./')` — and an absolute `'/'` in a spec fails loudly under a
     * non-root base instead of passing by accident.
     */
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        /**
         * A handset, because §9 judges this game mobile-first. §9.3's 360px
         * reference width is narrower still; the spec that cares resizes to it
         * rather than making every future spec run at the tightest case.
         */
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  webServer: {
    /**
     * A fresh build every run. `vite preview` serves `dist/` under the same
     * `base` the build resolved, which is what makes `E2E_BASE_URL` reachable
     * at all.
     */
    command: `npm run build && npx vite preview --port ${E2E_PREVIEW_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
