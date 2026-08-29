import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The Vitest half of the `npm run e2e` gate stage, run by `scripts/e2e.mjs`.
 *
 * It exists because `tests/e2e/` holds two kinds of file and only one of them
 * is a browser test. The root `vitest.config.ts` excludes `tests/e2e/**` — it
 * must, or `npm run test` would try to execute Playwright's `*.spec.ts` files
 * as unit tests and fail on the missing fixtures. That exclusion also hides the
 * `*.test.ts` assertions about `playwright.config.ts` itself, so this config
 * collects exactly those, and `scripts/e2e.mjs` runs them before spending two
 * minutes on a build and a browser.
 *
 * The division of labour: `*.test.ts` here is anything provable without a
 * browser, `*.spec.ts` is anything that needs one.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: ROOT,
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
