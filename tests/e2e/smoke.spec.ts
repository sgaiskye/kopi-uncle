import { expect, test, type Page, type Response } from '@playwright/test';

import { E2E_BASE_PATH, E2E_BASE_URL } from '../../playwright.config';

/**
 * S6-1 — the first real browser test.
 *
 * Every navigation here is **relative**. `use.baseURL` carries the subpath the
 * Vite build resolved (PRD §10.6), so `'./'` lands on the deployed entry
 * document and an absolute `'/'` would not. That is the whole point of the
 * sprint: if a base-path regression ships, these assertions fail before the
 * deploy does.
 *
 * Two kinds of assertion live here, and the difference matters:
 *
 *   - Those that hold under any base path — the wordmark renders, nothing 404s,
 *     nothing overflows at 360px — run always.
 *   - Those that are *about* the base path can only bite when the base path is
 *     not `/`. Under a root base `pathname.startsWith('/')` is universally true
 *     and there is no subpath to fail to redirect from, so they would report
 *     green while asserting nothing. They are grouped and skipped explicitly, so
 *     that green never reads as covered. `scripts/e2e.mjs` runs a non-root probe
 *     pass on every invocation precisely so this group actually executes.
 *
 * PRD §10.7's slot-clicking smoke test is deliberately not here — there is no
 * engine, no test seam and no slot selector yet. It lands with M2's integration
 * story. This spec asserts the one thing Sprint 1 does render, and asserts it
 * through the built bundle rather than the dev server.
 */

/** Requests to anywhere but the preview server are not this suite's business. */
const PREVIEW_ORIGIN = new URL(E2E_BASE_URL).origin;

/** True on every machine where `GITHUB_REPOSITORY` is unset — i.e. most of them. */
const BASE_IS_ROOT = E2E_BASE_PATH === '/';

const ROOT_BASE_SKIP_REASON =
  'the resolved base path is "/", where a base-path assertion cannot fail — ' +
  'covered by the non-root probe pass in scripts/e2e.mjs';

interface Traffic {
  /** Requests the preview server refused, or answered 4xx/5xx. */
  failures: string[];
  /** Same-origin responses whose pathname escaped the base path. */
  outsideBase: string[];
  /**
   * Every same-origin pathname seen. Kept so that `outsideBase: []` can be
   * shown to mean "nothing escaped" rather than "nothing was looked at" — an
   * empty list is the pass condition, so without this the assertion would also
   * pass on a page that loaded no assets at all.
   */
  sameOrigin: string[];
}

/**
 * Navigates relatively and records what the built bundle asked the server for.
 * Shared because both the always-on health assertion and the base-path guard
 * need the same page load, and a spec that reuses the recorder cannot drift from
 * one that does not.
 */
async function loadAndRecord(page: Page): Promise<{ response: Response | null; traffic: Traffic }> {
  const traffic: Traffic = { failures: [], outsideBase: [], sameOrigin: [] };

  page.on('requestfailed', (request) => {
    traffic.failures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    const { origin, pathname } = new URL(response.url());
    if (origin !== PREVIEW_ORIGIN) {
      return;
    }
    traffic.sameOrigin.push(pathname);
    if (!pathname.startsWith(E2E_BASE_PATH)) {
      traffic.outsideBase.push(`${response.status()} ${pathname}`);
    }
    if (response.status() >= 400) {
      traffic.failures.push(`${response.status()} ${pathname}`);
    }
  });

  const response = await page.goto('./', { waitUntil: 'networkidle' });

  return { response, traffic };
}

test.describe('the built app on its resolved base path', () => {
  test('serves the title screen wordmark from a relative navigation', async ({ page }) => {
    await page.goto('./');

    await expect(page.getByRole('heading', { name: 'KOPI UNCLE' })).toBeVisible();
  });

  test('serves every asset the built bundle asks for', async ({ page }) => {
    const { traffic } = await loadAndRecord(page);

    expect(
      traffic.failures,
      'the built app requested something the preview server could not serve',
    ).toEqual([]);
  });

  test('renders without horizontal overflow at a 360px viewport', async ({ page }) => {
    // PRD §9.3's reference width. The order-card assertion it demands arrives
    // with the queue; the page-level floor is cheap and belongs from the start.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('./');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  /*
   * The load-bearing group. Skipped — visibly, with a reason in the report —
   * when the base path is `/`, because there both assertions are tautologies.
   */
  test.describe('the base path itself', () => {
    test.skip(BASE_IS_ROOT, ROOT_BASE_SKIP_REASON);

    test('resolves the relative navigation under the base path, not the root', async ({ page }) => {
      const response = await page.goto('./');

      expect(new URL(page.url()).pathname).toBe(E2E_BASE_PATH);

      // `vite preview` helpfully redirects `/` to the base path. GitHub Pages
      // does not — there, `/` is a different site entirely. So arriving at the
      // right place is not enough: the navigation must have *started* there, or
      // an absolute `'/'` in a spec would pass locally and mislead about
      // production. No redirect means the base URL was already correct.
      //
      // Narrow, and known to be so: `vite preview`'s SPA fallback answers any
      // path with 200 and `index.html`, so this catches an absolute navigation
      // in a spec, not a wrong-base bundle. The assertion below catches that.
      expect(response?.request().redirectedFrom()).toBeNull();
    });

    test('loads every bundled asset from under the base path', async ({ page }) => {
      const { traffic } = await loadAndRecord(page);

      // The guard below passes on an empty list, so first prove the list was
      // populated at all. A build that emitted no JS, or a recorder wired to
      // the wrong origin, would otherwise look identical to a clean pass.
      expect(
        traffic.sameOrigin.filter((pathname) => pathname.endsWith('.js')),
        'no same-origin script was observed, so the base-path guard below ' +
          'would pass without inspecting anything',
      ).not.toEqual([]);

      expect(
        traffic.outsideBase,
        'an asset resolved above the base path — §10.6 regression',
      ).toEqual([]);
    });
  });
});
