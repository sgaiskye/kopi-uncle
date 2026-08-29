/**
 * S7-3 fixture — **this file must FAIL lint, three times.**
 *
 * PRD §3 constraint 7: no wall clock and no ambient randomness inside
 * `src/game/`. All three reads below are *member expressions*, which is why
 * §10.5 rules out `no-restricted-globals` as the mechanism — that rule matches
 * bare identifiers and would silently miss every line here.
 *
 * `tests/lint/boundary.test.ts` asserts this file yields exactly three
 * `no-restricted-syntax` messages, one per banned expression, so a selector
 * set that catches only `Date.now` fails the test.
 *
 * Do not "fix" this file. See the header of `game-imports-react.ts`.
 */
export function impureStamp(): number {
  const wall = Date.now();
  const high = performance.now();
  const noise = Math.random();
  return wall + high + noise;
}
