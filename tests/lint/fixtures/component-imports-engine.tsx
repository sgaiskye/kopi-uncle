/**
 * S7-3 fixture — **this file must FAIL lint.**
 *
 * The presentation→logic half of PRD §10.5's boundary. A component may import
 * exactly two things out of `src/game/`: `types` and `view`. The three engine
 * signatures are reached only through `src/app/EngineContext.tsx`, which is
 * what makes M2's stub→engine swap a one-file change.
 *
 * The `types` import below is legal and must stay: without it the fixture
 * could pass by banning everything under `src/game/`, which would prove
 * nothing. Only the `engine` import is expected to be reported.
 *
 * Do not "fix" this file. See the header of `game-imports-react.ts`.
 */
import type { GameState } from '../../../src/game/types';
import { tick } from '../../../src/game/engine';

export function advance(state: GameState): GameState {
  return tick(state, 16);
}
