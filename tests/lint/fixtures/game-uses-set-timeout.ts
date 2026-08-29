/**
 * S7-3 fixture — **this file must FAIL lint.**
 *
 * The identifier half of the §3 constraint 7 ban. `src/game/` schedules
 * nothing: R20 has time arrive as `dtMs` on `tick`, quantised into whole
 * `TICK_MS` steps, so an entire shift stays a pure fold and Playwright can
 * fast-forward it.
 *
 * Do not "fix" this file. See the header of `game-imports-react.ts`.
 */
export function scheduleLater(fn: () => void): void {
  setTimeout(fn, 16);
}
