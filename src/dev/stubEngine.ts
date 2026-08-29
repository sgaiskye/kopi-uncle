/**
 * S9-1 — the M0 stub engine: the same three signatures `src/game/engine.ts`
 * froze, backed by a **scripted replay** of `fixtures.ts`'s catalogue rather
 * than by a simulation.
 *
 * §10.5 is the reason this file exists at all. A stub that merely typechecks
 * unblocks nothing, because the states Track B has to render — patience rings
 * draining, mood faces turning, a break card, a game-over share grid — are
 * functions of behaviour *over time*. So `tick` walks a fixed timeline:
 * **calm → impatient → angry → walkout → break → gameover**, one entry per
 * `REPLAY_STEP_MS`. It never simulates, and Track B never simulates either.
 *
 * ## The replay cursor
 *
 * The engine is a pure reducer (§10.3), so the cursor cannot live in a module
 * closure — it has to be inside `GameState`. There is no spare field, so this
 * stub reuses **`tickRemainderMs`** as the elapsed-milliseconds cursor. That is
 * a deliberate, contained abuse of R20's sub-step carry, and it is contained
 * three ways: it is additive, so chunked advances and one long advance land on
 * the same entry; it leaves `rngState` free to hold the `START_RUN` seed
 * exactly as §10.3 intends, since the stub generates nothing and never advances
 * it; and `src/dev/` is deleted whole by an M2 story, so no real engine ever
 * inherits the reuse.
 *
 * ## Where it diverges from the frozen contract, and why
 *
 * - **`tick` walks out of `break`.** §10.3's identity clause returns the same
 *   reference whenever `phase !== 'playing'`, and R9 makes `DISMISS_BREAK` the
 *   only way past a break card. S9-1 requires repeated advances alone to reach
 *   `gameover`, so the replay steps through `break` on time as well as on
 *   `DISMISS_BREAK`. That is the *whole* of the divergence, and it is bounded by
 *   the end of the script: past the last entry there is nothing left to walk to,
 *   so `tick` hands back the identical reference again and the game-over card
 *   does not re-render at 60fps forever. The rest of the clause is honoured too:
 *   `dtMs === 0` returns the identical reference, `phase === 'paused'` is a
 *   total no-op per R19, and `builder` keeps its identity across a whole run of
 *   ticks so §9.4's SVG preview is not rebuilt every frame.
 * - **Nothing is graded.** M1a owns §7.6's order comparison, so `SERVE` does not
 *   decide right from wrong — it simply steps the replay. The wrong-serve states
 *   Track B must build against are named fixtures (`POST_WRONG_SERVE`,
 *   `MID_LOCKOUT`), not something this file computes.
 * - **Nothing is scored, spawned or drained.** Those are M1a's, and a second
 *   implementation here would be a fiction a Track B test could pass against.
 *
 * What it *does* honour, because Track B builds real behaviour on it: R4's
 * no-op serve, R5's lockout swallowing player input, R9's explicit break
 * dismissal, R19's pause rules, R21's frame-local `frameEvents`, and R2/§8.2's
 * builder persisting across everything but `START_RUN`.
 *
 * ## R21, and why an entry's events fire exactly once
 *
 * A timeline entry *dwells* for `REPLAY_STEP_MS`, so at a 16ms cadence a naive
 * replay would re-deliver a one-shot `walkout` or `heartLost` ~375 times in a
 * row and `gameOver` forever. R21 makes `frameEvents` a frame-local outbox,
 * overwritten on every call, so `at` hands an entry's events to the frame that
 * **crosses into** it and `NO_EVENTS` to every frame that merely dwells there.
 * A Track B effect keyed on `frameEvents` therefore fires once, exactly as it
 * will against M1a's engine.
 *
 * The terminal state is the one place events outlive their frame, and that is
 * the frozen contract rather than a stub artefact: `tick` returns the identical
 * reference once the replay clamps, so the state carrying `gameOver` simply
 * stays put — which is precisely what §10.3's identity clause makes the real
 * engine do after it writes `gameOver` and stops. The reference never changes,
 * so nothing downstream re-fires.
 *
 * ## Which fixtures may be handed to it
 *
 * The replay cursor lives in `tickRemainderMs`, so only the fixtures that carry
 * one — `fixtures.ts`'s `TIMELINE` states, plus `SHIFT_BREAK_CLEARED` — are
 * *drivable*. The rest of the catalogue is for rendering; see the note above
 * `REPLAY_AT` in `fixtures.ts`.
 */
import type { Action, GameEvent, GameState, Mode } from '../game/types';
import { setSlot } from '../game/types';
import { TIMELINE, type TimelineEntry } from './fixtures';

/**
 * R21 — `frameEvents` is a frame-local outbox, overwritten on every call and
 * never appended to. One shared frozen empty array, so a run of event-free calls
 * allocates nothing and §10.3's identity clause has something stable to hold.
 */
const NO_EVENTS: GameEvent[] = [];
Object.freeze(NO_EVENTS);

const LAST_INDEX = TIMELINE.length - 1;

/** The last entry whose `atMs` has been reached — the replay clamps at its end. */
function entryAt(elapsedMs: number): TimelineEntry {
  let found = TIMELINE[0];
  for (const entry of TIMELINE) {
    if (entry.atMs <= elapsedMs) found = entry;
  }
  return found;
}

/**
 * The replay at `elapsedMs`, carrying forward the three things that belong to
 * the run rather than to the script: the `mode` and `seed` `START_RUN` chose,
 * §8.2's builder, and the player's focus for as long as that customer is still
 * in the queue (R3 re-resolves it to the front otherwise).
 *
 * R21 decides `frameEvents` here and nowhere else. An entry's events describe
 * the *moment* the run entered it — a customer walking out, a shift clearing,
 * the run ending — so they belong to the frame that crosses the boundary and to
 * no other. Frames that land inside the entry the cursor was already in get the
 * empty outbox, which is what keeps a one-shot event one-shot across an entry's
 * `REPLAY_STEP_MS` dwell.
 */
function at(state: GameState, elapsedMs: number): GameState {
  const entry = entryAt(elapsedMs);
  const next = entry.state;
  const crossed = entry !== entryAt(state.tickRemainderMs);
  const keepsFocus =
    state.activeId !== null && next.queue.some((waiting) => waiting.id === state.activeId);
  return {
    ...next,
    mode: state.mode,
    builder: state.builder,
    activeId: keepsFocus ? state.activeId : next.activeId,
    rngState: state.rngState,
    tickRemainderMs: elapsedMs,
    frameEvents: crossed ? next.frameEvents : NO_EVENTS,
  };
}

/**
 * One entry further along the replay.
 *
 * At the last entry there is nowhere to step to, so the state comes back
 * unchanged — `step` is total over `GameState`, and the stub's exports are
 * public, so a caller may legitimately hand in a `break`-phase state parked at
 * the end of the script. Below the last entry the target is always
 * `next.atMs`: `entryAt(cursor) === TIMELINE[index]` means the cursor has not
 * yet reached `TIMELINE[index + 1]`, so no `Math.max` is needed to keep the
 * cursor moving forwards.
 */
function step(state: GameState): GameState {
  const index = TIMELINE.indexOf(entryAt(state.tickRemainderMs));
  if (index === LAST_INDEX) return state;
  return at(state, TIMELINE[index + 1].atMs);
}

/** R5 and R19 — the two states in which every player action is swallowed. */
function acceptsPlayerInput(state: GameState): boolean {
  return state.phase === 'playing' && state.lockoutMs <= 0;
}

/**
 * §10.3's pre-title bootstrap, and — via `START_RUN` below — the run's single
 * reset path. The seed is kept in `rngState` where §10.3 puts it; this stub
 * never reads it, because a scripted replay has nothing to randomise.
 */
export function createInitialState(mode: Mode, seed: number): GameState {
  return {
    ...TIMELINE[0].state,
    mode,
    rngState: seed,
    tickRemainderMs: 0,
    frameEvents: NO_EVENTS,
  };
}

/**
 * §10.3's clock, as a replay. `dtMs` is floored to integer milliseconds (R20)
 * and clamped at zero, so a negative or fractional delta from a real rAF loop
 * can never walk the script backwards.
 */
export function tick(state: GameState, dtMs: number): GameState {
  const advanceMs = Math.max(0, Math.trunc(dtMs));
  // §10.3's identity clause, and R19's total no-op while paused.
  if (advanceMs === 0 || state.phase === 'paused') return state;
  // The one divergence — walking out of `break` on time — stops at the end of
  // the script. Past the last entry §10.3's identity clause applies in full, so
  // the game-over card is handed the same reference every frame rather than an
  // equal-but-new object 60 times a second.
  if (entryAt(state.tickRemainderMs) === TIMELINE[LAST_INDEX]) return state;
  return at(state, state.tickRemainderMs + advanceMs);
}

/**
 * §10.3's reducer over the seven `Action` variants. Exhaustive by construction:
 * every variant returns, so there is no `default` arm and no unreachable line
 * for §10.7's coverage threshold to be unable to cover.
 */
export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START_RUN':
      // §10.3 — one reset path, not two.
      return createInitialState(action.mode, action.seed);

    case 'PAUSE':
      // R19 — legal only from `playing`.
      return state.phase === 'playing'
        ? { ...state, phase: 'paused', frameEvents: NO_EVENTS }
        : state;

    case 'RESUME':
      // R19 — legal only from `paused`, and `lockoutMs` survives the pause.
      return state.phase === 'paused'
        ? { ...state, phase: 'playing', frameEvents: NO_EVENTS }
        : state;

    case 'DISMISS_BREAK':
      // R9 — the break card never auto-advances.
      return state.phase === 'break' ? step(state) : state;

    case 'FOCUS':
      // R5 swallows it under lockout; R3 lets the player override focus at will,
      // but only onto a customer who is actually in the queue.
      if (!acceptsPlayerInput(state)) return state;
      return state.queue.some((waiting) => waiting.id === action.customerId)
        ? { ...state, activeId: action.customerId, frameEvents: NO_EVENTS }
        : state;

    case 'SET_SLOT':
      // R18 — never rejects, never auto-corrects; the builder may legally hold a
      // drink `isValidDrink` rejects. Written through the frozen contract's
      // `setSlot` helper, which is the only place §10.3's cast may live.
      if (!acceptsPlayerInput(state)) return state;
      return {
        ...state,
        builder: setSlot(state.builder, action.slot, action.value),
        frameEvents: NO_EVENTS,
      };

    case 'SERVE':
      // R4 — a serve with nothing focused is a no-op in every respect. R5 —
      // swallowed under lockout. Otherwise the replay steps: this stub grades
      // nothing (§7.6 is M1a's), so a serve is a way to move the script on.
      if (!acceptsPlayerInput(state) || state.activeId === null) return state;
      return step(state);
  }
}
