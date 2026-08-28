import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { basePathFor } from '../../vite.config';
import playwrightConfig, {
  E2E_BASE_PATH,
  E2E_BASE_URL,
  E2E_PREVIEW_PORT,
} from '../../playwright.config';

/**
 * S6-1's static half. These are the assertions PRD §10.6 needs to hold about
 * the *runner* rather than about the app: chromium only, the built app rather
 * than the dev server, and the real subpath rather than the root.
 *
 * `npm run test` does not collect this file — `vitest.config.ts` excludes
 * `tests/e2e/**` so that Playwright's `*.spec.ts` files are never mistaken for
 * unit tests. `scripts/e2e.mjs` therefore runs the `*.test.ts` half of this
 * directory through Vitest itself before handing off to Playwright, which is
 * why the `npm run e2e` gate stage covers both.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CONFIG_SOURCE = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8');

/** A repository name this checkout is emphatically not called. */
const FOREIGN_REPOSITORY = 'acme/demo';

/**
 * The names this repository actually goes by — the same derivation
 * `tests/scaffold/build.test.ts` applies to `vite.config.ts`, for the same
 * reason. The checkout directory is deliberately not among them: a clone, a
 * rename or a git worktree changes it freely, so it stops testing anything real
 * the moment someone renames the folder.
 */
function repositoryNames(): string[] {
  const names = new Set<string>();

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: string };
  if (pkg.name !== undefined && pkg.name !== '') {
    names.add(pkg.name);
  }

  const remote = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (remote.status === 0) {
    const slug = remote.stdout
      .trim()
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .pop();
    if (slug !== undefined && slug !== '') {
      names.add(slug);
    }
  }

  return [...names];
}

describe('playwright.config.ts', () => {
  it('points at tests/e2e', () => {
    expect(playwrightConfig.testDir).toBe('tests/e2e');
  });

  it('declares exactly one project, chromium', () => {
    const projects = playwrightConfig.projects ?? [];
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('chromium');
  });

  it('needs no browser but chromium, so `playwright install chromium` suffices', () => {
    const projects = playwrightConfig.projects ?? [];
    expect(projects[0]?.use?.browserName).toBe('chromium');

    // A `channel` would pull a branded Chrome or Edge that no CI step installs.
    expect(projects[0]?.use?.channel).toBeUndefined();
    expect(playwrightConfig.use?.channel).toBeUndefined();

    for (const other of ['firefox', 'webkit']) {
      expect(CONFIG_SOURCE, `${other} needs a binary that CI never installs`).not.toContain(other);
    }
  });

  it('runs specs only, so the Vitest half of tests/e2e is never treated as a spec', () => {
    expect(playwrightConfig.testMatch).toBe('**/*.spec.ts');
  });

  it('writes its artefacts only into already-gitignored directories', () => {
    const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim().replace(/\/$/, ''))
      .filter(Boolean);

    expect(playwrightConfig.outputDir).toBe('test-results');
    expect(ignored).toContain('test-results');
    expect(ignored).toContain('playwright-report');
  });
});

describe('the resolved base path', () => {
  it('is the one the Vite build resolved, not a literal', () => {
    expect(E2E_BASE_PATH).toBe(basePathFor(process.env.GITHUB_REPOSITORY));
  });

  it('is derived, so a fork, a rename or a clone under any name still works', () => {
    // PRD §10.6: the repository name appears nowhere as a literal. Proving that
    // needs the *deriving function* rather than this process's own value, since
    // the config resolved its constant once at import time.
    expect(basePathFor(FOREIGN_REPOSITORY)).toBe('/demo/');
    expect(basePathFor(undefined)).toBe('/');

    expect(CONFIG_SOURCE).toMatch(/basePathFor\(/);

    const names = repositoryNames();
    expect(
      names.length,
      'no repository name could be derived from package.json or the git remote, ' +
        'so this assertion would pass vacuously',
    ).toBeGreaterThan(0);
    expect(
      names.filter((name) => CONFIG_SOURCE.includes(name)),
      'the base path is derived from the Vite config (PRD §10.6), so this ' +
        'repository name must not appear in the Playwright config',
    ).toEqual([]);
  });

  it('always begins and ends with a slash, so a relative goto() resolves under it', () => {
    expect(E2E_BASE_PATH.startsWith('/')).toBe(true);
    expect(E2E_BASE_PATH.endsWith('/')).toBe(true);
  });
});

describe('use.baseURL', () => {
  it('ends with the resolved base path', () => {
    const baseURL = playwrightConfig.use?.baseURL;
    expect(baseURL).toBe(E2E_BASE_URL);
    expect(baseURL?.endsWith(E2E_BASE_PATH)).toBe(true);
  });

  it('is an absolute http URL on the fixed preview port', () => {
    const url = new URL(E2E_BASE_URL);
    expect(url.protocol).toBe('http:');
    expect(url.port).toBe(String(E2E_PREVIEW_PORT));
    expect(url.pathname).toBe(E2E_BASE_PATH);
  });
});

describe('webServer', () => {
  const webServer = playwrightConfig.webServer;

  it('is a single server, not an array', () => {
    expect(webServer).toBeTruthy();
    expect(Array.isArray(webServer)).toBe(false);
  });

  it('previews a fresh build rather than serving the dev server', () => {
    const command = (webServer as { command: string }).command;
    expect(command).toMatch(/\bbuild\b/);
    expect(command).toMatch(/\bpreview\b/);
    expect(command, 'the dev server does not exercise the built asset paths').not.toMatch(
      /vite dev|run dev/,
    );
  });

  it('pins the port strictly, so a busy port fails loudly instead of drifting', () => {
    const command = (webServer as { command: string }).command;
    expect(command).toContain(`--port ${E2E_PREVIEW_PORT}`);
    expect(command).toContain('--strictPort');
  });

  it('waits on a url that includes the resolved base path', () => {
    const url = (webServer as { url?: string }).url;
    expect(url).toBe(E2E_BASE_URL);
    expect(url?.endsWith(E2E_BASE_PATH)).toBe(true);
  });

  it('reuses a running server everywhere but CI', () => {
    expect((webServer as { reuseExistingServer?: boolean }).reuseExistingServer).toBe(
      !process.env.CI,
    );
  });
});
