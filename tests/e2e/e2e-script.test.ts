import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * S6-1 — the failure paths of `scripts/e2e.mjs`, and the one behaviour of it
 * that the sprint's guarantee rests on.
 *
 * The script is the gate stage itself, so it cannot test itself in place: a run
 * that reached the real Playwright CLI would build, launch a browser and take
 * minutes. Instead each case copies the script into a temporary root and gives
 * it *fake* CLIs — the same technique `tests/scaffold/gate-scripts.test.ts` uses
 * on the placeholder scripts, for the same reason. The temp root lives under the
 * OS temp directory rather than inside the repo so that Node cannot resolve the
 * real `@playwright/test` by walking up, which would make the chromium preflight
 * launch an actual browser.
 *
 * The load-bearing case is the last one. `scripts/e2e.mjs` runs the browser
 * suite twice — once under a synthetic non-root `GITHUB_REPOSITORY`, once as
 * invoked — because the base-path assertions in `smoke.spec.ts` are tautologies
 * under a root base, which is what every machine without `GITHUB_REPOSITORY`
 * resolves. Deleting the probe pass would leave the whole suite green and
 * asserting nothing about subpaths, which is exactly the regression this sprint
 * exists to prevent. So it is asserted, not trusted to a comment.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'e2e.mjs');

/** Where each fake Playwright CLI records the base path it was invoked under. */
const INVOCATION_LOG = 'playwright-invocations.log';

const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface FakeCli {
  /** Exit code the fake CLI reports. */
  exitCode?: number;
  /** Extra body, appended before the exit. */
  body?: string;
}

/**
 * Builds a temp root holding a copy of the script plus whichever fake CLIs the
 * case wants. A CLI left out is a CLI the script must report as missing.
 */
function makeRoot(options: { vitest?: FakeCli; playwright?: FakeCli }): string {
  const root = mkdtempSync(join(tmpdir(), 'kopi-e2e-script-'));
  tempRoots.push(root);

  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts', 'e2e.mjs'));

  if (options.vitest !== undefined) {
    const dir = join(root, 'node_modules', 'vitest');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'vitest.mjs'),
      `${options.vitest.body ?? ''}\nprocess.exit(${options.vitest.exitCode ?? 0});\n`,
    );
  }

  if (options.playwright !== undefined) {
    // Deliberately no package.json: the script's `import('@playwright/test')`
    // preflight must fail to resolve here, so no real browser is launched,
    // while `existsSync(cli.js)` still finds this file.
    const dir = join(root, 'node_modules', '@playwright', 'test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'cli.js'),
      `${options.playwright.body ?? ''}\nprocess.exit(${options.playwright.exitCode ?? 0});\n`,
    );
  }

  return root;
}

/**
 * A fake Playwright CLI that appends the `GITHUB_REPOSITORY` it saw to the log.
 * That variable is the single input `basePathFor` derives the base path from, so
 * it is exactly what distinguishes one pass from another.
 */
const RECORDING_PLAYWRIGHT_CLI = `
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
appendFileSync(
  join(process.cwd(), ${JSON.stringify(INVOCATION_LOG)}),
  (process.env.GITHUB_REPOSITORY ?? '<unset>') + '\\n',
);
`;

function runScript(root: string, env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  // Both are deleted unless the case sets them, so the assertions describe the
  // default invocation rather than whatever the outer shell happened to export.
  for (const key of ['GITHUB_REPOSITORY', 'E2E_SKIP_BASE_PATH_PROBE']) {
    if (env[key] === undefined) {
      delete childEnv[key];
    }
  }

  return spawnSync(process.execPath, [join(root, 'scripts', 'e2e.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: childEnv,
  });
}

function invocations(root: string): string[] {
  try {
    return readFileSync(join(root, INVOCATION_LOG), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Where a fake `chromium.launch()` records that it was called. */
const LAUNCH_LOG = 'chromium-launches.log';

/**
 * Makes `import('@playwright/test')` resolve inside a temp root to a stub whose
 * `chromium.launch()` behaves as the case wants. CommonJS on purpose — the fake
 * `cli.js` beside it is CommonJS, so a `"type": "module"` here would break it.
 */
function withPlaywrightModule(root: string, launchBody: string): string {
  const dir = join(root, 'node_modules', '@playwright', 'test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@playwright/test', exports: { '.': './index.js' } }),
  );
  writeFileSync(
    join(dir, 'index.js'),
    `exports.chromium = { launch: async () => {\n${launchBody}\n} };\n`,
  );
  return root;
}

function launches(root: string): string[] {
  try {
    return readFileSync(join(root, LAUNCH_LOG), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('scripts/e2e.mjs failure paths', () => {
  it('reports a missing Vitest rather than crashing, and names the fix', () => {
    const result = runScript(makeRoot({}));

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is not installed/);
    expect(result.stderr, 'the message must name the command that fixes it').toMatch(/npm ci/);
  });

  it('propagates a failing stage exit code rather than flattening it to 1', () => {
    // A gate that reports 1 for everything loses the distinction between a
    // failed assertion and a crashed runner.
    const result = runScript(makeRoot({ vitest: { exitCode: 3 } }));

    expect(result.status).toBe(3);
  });

  it('stops at the Vitest stage, before spending a build on Playwright', () => {
    const root = makeRoot({
      vitest: { exitCode: 1 },
      playwright: { body: RECORDING_PLAYWRIGHT_CLI },
    });

    const result = runScript(root);

    expect(result.status).toBe(1);
    expect(invocations(root), 'the browser half must not run after a red config stage').toEqual([]);
  });

  it('reports a missing Playwright CLI once Vitest has passed', () => {
    const result = runScript(makeRoot({ vitest: { exitCode: 0 } }));

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is not installed/);
  });
});

describe('scripts/e2e.mjs base-path passes', () => {
  it('runs the browser suite under a non-root base path even with no environment set', () => {
    const root = makeRoot({
      vitest: { exitCode: 0 },
      playwright: { body: RECORDING_PLAYWRIGHT_CLI },
    });

    const result = runScript(root);
    expect(result.status).toBe(0);

    const seen = invocations(root);
    expect(seen, 'both the probe pass and the invoked pass must run').toHaveLength(2);

    // The ambient pass: nothing set, so the base path resolves to `/`.
    expect(seen).toContain('<unset>');

    // The probe pass: a synthetic `<owner>/<repo>`, whose second segment
    // `basePathFor` turns into a non-root base. Asserted by shape rather than
    // by literal, since the probe value is the script's to choose.
    const probes = seen.filter((slug) => slug !== '<unset>');
    expect(probes, 'exactly one synthetic non-root pass').toHaveLength(1);
    const repo = probes[0]?.split('/')[1]?.trim();
    expect(repo, 'the probe slug must yield a non-empty second segment').toBeTruthy();
    expect(
      probes[0],
      'the probe must not pin the suite to this repository under another name',
    ).not.toMatch(/kopi-uncle/);
  });

  it('honours the caller’s GITHUB_REPOSITORY in the non-probe pass', () => {
    const root = makeRoot({
      vitest: { exitCode: 0 },
      playwright: { body: RECORDING_PLAYWRIGHT_CLI },
    });

    const result = runScript(root, { GITHUB_REPOSITORY: 'acme/demo' });
    expect(result.status).toBe(0);

    const seen = invocations(root);
    expect(seen, 'the probe still runs alongside the requested base path').toHaveLength(2);
    expect(seen).toContain('acme/demo');
  });
});

/*
 * The preflight is a real headless launch rather than a path test, because
 * Playwright's public API only exposes `chromium.executablePath()` — the full
 * Chrome for Testing build — while a headless `chromium` run launches
 * `chromium_headless_shell-*`, a separate download since Playwright 1.49. A path
 * check would false-pass into exactly the stack trace the preflight replaces.
 * These cases pin the behaviour a path check could not deliver.
 */
describe('scripts/e2e.mjs chromium preflight', () => {
  it('turns a launch failure into the install command, before any build', () => {
    const root = withPlaywrightModule(
      makeRoot({ vitest: { exitCode: 0 }, playwright: { body: RECORDING_PLAYWRIGHT_CLI } }),
      'throw new Error("Executable doesn\'t exist at /nowhere/chrome-headless-shell\\nnoise");',
    );

    const result = runScript(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npx playwright install --with-deps chromium');
    expect(result.stderr, 'the underlying reason must not be swallowed').toContain(
      "Executable doesn't exist",
    );
    expect(
      invocations(root),
      'the preflight buys nothing unless it precedes the browser suite',
    ).toEqual([]);

    // The continuation lines align under the `e2e: ` prefix from that prefix's
    // own length, so renaming it cannot leave a hardcoded indent behind.
    const reported = result.stderr.split('\n').filter((line) => line.trim() !== '');
    expect(reported.length, 'the failure is multi-line, so alignment matters').toBeGreaterThan(1);
    expect(reported[0]?.startsWith('e2e: ')).toBe(true);
    for (const line of reported.slice(1)) {
      expect(line.startsWith('     ')).toBe(true);
      expect(line.startsWith('      ')).toBe(false);
    }
  });

  it('launches once for the whole run rather than once per base-path pass', () => {
    const root = withPlaywrightModule(
      makeRoot({ vitest: { exitCode: 0 }, playwright: { body: RECORDING_PLAYWRIGHT_CLI } }),
      [
        "const { appendFileSync } = require('node:fs');",
        "const { join } = require('node:path');",
        `appendFileSync(join(process.cwd(), ${JSON.stringify(LAUNCH_LOG)}), 'launched\\n');`,
        'return { close: async () => {} };',
      ].join('\n'),
    );

    const result = runScript(root);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(invocations(root), 'both passes still run').toHaveLength(2);
    expect(launches(root), 'the browser is the same for both passes').toHaveLength(1);
  });
});
