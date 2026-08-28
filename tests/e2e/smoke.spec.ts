import { expect, test } from '@playwright/test';

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
 * PRD §10.7's slot-clicking smoke test is deliberately not here — there is no
 * engine, no test seam and no slot selector yet. It lands with M2's integration
 * story. This spec asserts the one thing Sprint 1 does render, and asserts it
 * through the built bundle rather than the dev server.
 */

/** Requests to anywhere but the preview server are not this suite's business. */
const PREVIEW_ORIGIN = new URL(E2E_BASE_URL).origin;

test.describe('the built app on its resolved base path', () => {
  test('serves the title screen wordmark from a relative navigation', async ({ page }) => {
    await page.goto('./');

    await expect(page.getByRole('heading', { name: 'KOPI UNCLE' })).toBeVisible();
  });

  test('resolves the relative navigation under the base path, not the root', async ({ page }) => {
    const response = await page.goto('./');

    expect(new URL(page.url()).pathname).toBe(E2E_BASE_PATH);

    // `vite preview` helpfully redirects `/` to the base path. GitHub Pages
    // does not — there, `/` is a different site entirely. So arriving at the
    // right place is not enough: the navigation must have *started* there, or
    // an absolute `'/'` in a spec would pass locally and mislead about
    // production. No redirect means the base URL was already correct.
    expect(response?.request().redirectedFrom()).toBeNull();
  });

  test('loads every bundled asset from under the base path', async ({ page }) => {
    const failures: string[] = [];
    const outsideBase: string[] = [];

    page.on('requestfailed', (request) => {
      failures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
    });
    page.on('response', (response) => {
      const { origin, pathname } = new URL(response.url());
      if (origin !== PREVIEW_ORIGIN) {
        return;
      }
      if (!pathname.startsWith(E2E_BASE_PATH)) {
        outsideBase.push(`${response.status()} ${pathname}`);
      }
      if (response.status() >= 400) {
        failures.push(`${response.status()} ${pathname}`);
      }
    });

    await page.goto('./', { waitUntil: 'networkidle' });

    expect(
      failures,
      'the built app requested something the preview server could not serve',
    ).toEqual([]);
    expect(outsideBase, 'an asset resolved above the base path — §10.6 regression').toEqual([]);
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
});
