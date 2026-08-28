/**
 * S3-1's last criterion: *a failing `expectTypeOf` assertion is a gate failure*.
 *
 * Vitest's own `typecheck` mode is configured in `vitest.config.ts`, which
 * Sprint 8 owns and this sprint does not touch — and it collects only
 * `*.test-d.ts` files, so turning it on would not cover the `expectTypeOf`
 * assertions that live alongside the runtime ones in `types.test.ts` anyway.
 * The property that matters is the one asserted here instead: the compiler runs
 * *inside* `npm run test`, over the same `tsconfig.json` that includes `tests/`,
 * so a drifted contract reds `npm run test` and not merely `npm run typecheck`.
 *
 * The negative control is `tests/contract/types.test.ts` itself — its
 * `satisfies never` assignment and its `expectTypeOf` calls are verified to bite
 * by construction: adding an eighth `Action` variant reds TS2344 on
 * `ActionTypesAreExhaustive` and TS1360 on the `satisfies never`, both of which
 * this spawn surfaces as a test failure.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSC = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));

describe('type assertions are enforced by `npm run test`', () => {
  it('compiles the project, tests included, with no diagnostics', () => {
    const result = spawnSync(process.execPath, [TSC, '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(`${result.stdout}${result.stderr}`.trim()).toBe('');
    expect(result.status).toBe(0);
  }, 120_000);
});
