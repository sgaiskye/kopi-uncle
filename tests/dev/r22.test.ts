/**
 * S9-1 — R22 run against the M0 stub.
 *
 * The property itself lives in `./r22` and is deliberately not restated here.
 * R22 requires it to be asserted "on both the engine and the M0 stub, so the two
 * cannot silently disagree", and two hand-written tests of the same sentence
 * disagree the moment one is edited. M1a adds a file exactly like this one
 * pointing at `src/game/engine.ts`.
 */
import * as stub from '../../src/dev/stubEngine';
import { runR22Property } from './r22';

runR22Property('src/dev/stubEngine.ts', stub);
