/**
 * S9-1 — `src/dev/stubEngine.ts`, the scripted replay Track B develops against.
 *
 * Two things are worth testing about a stub, and only two. The first is that it
 * is a **drop-in for the frozen seam**: the same three exports, the same arities,
 * so M2's swap in `EngineContext.tsx` is a one-line change rather than a
 * refactor. The second is that it is a **replay rather than a fake**: repeated
 * advances have to reach every state §10.5 lists, or a Track B story could ship
 * without ever having rendered a break card.
 *
 * R22's property is not restated here — it is imported from `./r22`, which M1a
 * re-uses verbatim against the real engine so the two cannot silently disagree.
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/game/engine';
import * as stub from '../../src/dev/stubEngine';
import { CONFIG } from '../../src/game/config';
import { isValidDrink, moodFor } from '../../src/game/view';
import type { Action, GameState } from '../../src/game/types';
import {
  MID_LOCKOUT,
  MOOD_CALM,
  PLAIN_KOPI,
  REPLAY_STEP_MS,
  SHIFT_BREAK,
  THREE_CUSTOMERS,
  TIMELINE,
} from '../../src/dev/fixtures';

const SEED = 20260829;

/** The phase, and the mood of whoever is at the front of the queue (§9.6). */
function shapeOf(state: GameState): string {
  if (state.queue.length === 0) return `${state.phase}/none`;
  const front = state.queue[0];
  return `${state.phase}/${moodFor(front.patienceMs, front.maxPatienceMs)}`;
}

/** Folds a fixed list of advances, recording the shape after each one. */
function foldAdvances(from: GameState, advances: readonly number[]): string[] {
  let state = from;
  const seen = [shapeOf(state)];
  for (const dtMs of advances) {
    state = stub.tick(state, dtMs);
    seen.push(shapeOf(state));
  }
  return seen;
}

describe('the stub is a drop-in for §10.5’s three frozen signatures', () => {
  it('exports exactly what src/game/engine.ts exports', () => {
    expect(Object.keys(stub).sort()).toEqual(Object.keys(engine).sort());
    expect(Object.keys(stub).sort()).toEqual(['applyAction', 'createInitialState', 'tick']);
  });

  it('declares the same arity for each of them', () => {
    expect(stub.createInitialState.length).toBe(engine.createInitialState.length);
    expect(stub.tick.length).toBe(engine.tick.length);
    expect(stub.applyAction.length).toBe(engine.applyAction.length);
  });

  it('does not throw where engine.ts still does — which is the whole point', () => {
    expect(() => engine.createInitialState('daily', SEED)).toThrow(Error);
    expect(() => stub.createInitialState('daily', SEED)).not.toThrow();
  });

  it('keeps §10.3’s seed where §10.3 puts it', () => {
    expect(stub.createInitialState('endless', SEED).rngState).toBe(SEED);
    expect(stub.createInitialState('endless', SEED).mode).toBe('endless');
    expect(stub.createInitialState('daily', SEED).mode).toBe('daily');
  });
});

describe('repeated advances walk §10.5’s timeline', () => {
  it('reaches calm → impatient → angry → walkout → break → gameover', () => {
    const advances = Array.from({ length: TIMELINE.length - 1 }, () => REPLAY_STEP_MS);
    expect(foldAdvances(stub.createInitialState('daily', SEED), advances)).toEqual([
      'playing/none',
      'playing/calm',
      'playing/impatient',
      'playing/angry',
      'playing/none',
      'break/none',
      'gameover/none',
    ]);
  });

  it('reaches the same entries under a chunked rAF-sized advance', () => {
    // R20's clamp is `MAX_FRAME_MS`, so a real React layer never hands the engine
    // one 6-second delta. Chunking must land on the same entries.
    const chunks = Math.ceil((REPLAY_STEP_MS * (TIMELINE.length - 1)) / CONFIG.MAX_FRAME_MS);
    const advances = Array.from({ length: chunks }, () => CONFIG.MAX_FRAME_MS);
    const shapes = foldAdvances(stub.createInitialState('daily', SEED), advances);
    expect([...new Set(shapes)]).toEqual([
      'playing/none',
      'playing/calm',
      'playing/impatient',
      'playing/angry',
      'break/none',
      'gameover/none',
    ]);
    expect(shapes[shapes.length - 1]).toBe('gameover/none');
  });

  it('is chunk-invariant: two advances land exactly where one long one does', () => {
    const start = stub.createInitialState('daily', SEED);
    const chunked = stub.tick(stub.tick(start, REPLAY_STEP_MS), REPLAY_STEP_MS);
    const single = stub.tick(start, REPLAY_STEP_MS * 2);
    expect(chunked).toEqual(single);
  });

  it('loses hearts on the way and never regains them', () => {
    let state = stub.createInitialState('daily', SEED);
    const hearts: number[] = [state.hearts];
    for (let index = 0; index < TIMELINE.length; index += 1) {
      state = stub.tick(state, REPLAY_STEP_MS);
      hearts.push(state.hearts);
    }
    expect(hearts[0]).toBe(CONFIG.HEARTS);
    expect(hearts[hearts.length - 1]).toBe(0);
    expect(hearts).toEqual([...hearts].sort((left, right) => right - left));
  });

  it('clamps at the end rather than running off it', () => {
    let state = stub.createInitialState('daily', SEED);
    for (let index = 0; index < TIMELINE.length * 3; index += 1) {
      state = stub.tick(state, REPLAY_STEP_MS);
    }
    expect(state.phase).toBe('gameover');
    expect(state.hearts).toBe(0);
  });
});

describe('the parts of §10.3’s contract the stub does honour', () => {
  it('returns the identical reference for a zero, negative or sub-millisecond dtMs', () => {
    const state = stub.createInitialState('daily', SEED);
    for (const dtMs of [0, -1, -REPLAY_STEP_MS, 0.5]) {
      expect(stub.tick(state, dtMs)).toBe(state);
    }
  });

  it('is a total no-op while paused (R19), and resumes where it left off', () => {
    const playing = stub.tick(stub.createInitialState('daily', SEED), REPLAY_STEP_MS);
    const paused = stub.applyAction(playing, { type: 'PAUSE' });
    expect(paused.phase).toBe('paused');
    expect(stub.tick(paused, REPLAY_STEP_MS * 3)).toBe(paused);

    const resumed = stub.applyAction(paused, { type: 'RESUME' });
    expect(resumed.phase).toBe('playing');
    expect(shapeOf(stub.tick(resumed, REPLAY_STEP_MS))).toBe('playing/impatient');
  });

  it('preserves builder identity across a thousand ticks with no SET_SLOT', () => {
    let state = stub.createInitialState('daily', SEED);
    const builder = state.builder;
    for (let index = 0; index < 1000; index += 1) {
      state = stub.tick(state, CONFIG.TICK_MS);
    }
    expect(Object.is(state.builder, builder)).toBe(true);
  });

  it('makes START_RUN and createInitialState one reset path, not two', () => {
    const late = stub.tick(stub.createInitialState('daily', SEED), REPLAY_STEP_MS * 4);
    const restarted = stub.applyAction(late, { type: 'START_RUN', mode: 'endless', seed: 7 });
    expect(restarted).toEqual(stub.createInitialState('endless', 7));
    expect(restarted.hearts).toBe(CONFIG.HEARTS);
  });

  it('overwrites frameEvents rather than appending to them (R21)', () => {
    const walkout = stub.tick(stub.createInitialState('daily', SEED), REPLAY_STEP_MS * 4);
    expect(walkout.frameEvents.length).toBeGreaterThan(0);
    const focused = stub.applyAction(walkout, { type: 'PAUSE' });
    expect(focused.frameEvents).toEqual([]);
  });
});

describe('the player actions the stub has to answer for Track B', () => {
  it('R4 — SERVE with nothing focused is a no-op in every respect', () => {
    const empty = stub.createInitialState('daily', SEED);
    expect(empty.activeId).toBeNull();
    expect(stub.applyAction(empty, { type: 'SERVE' })).toBe(empty);
  });

  it('R5 — every player action is swallowed while the lockout runs', () => {
    const swallowed: Action[] = [
      { type: 'SERVE' },
      { type: 'FOCUS', customerId: 1 },
      { type: 'SET_SLOT', slot: 'sugar', value: 'kosong' },
    ];
    for (const action of swallowed) {
      expect(stub.applyAction(MID_LOCKOUT, action), action.type).toBe(MID_LOCKOUT);
    }
  });

  it('R3 — focus follows the player onto any queued card, and ignores a stale id', () => {
    expect(stub.applyAction(THREE_CUSTOMERS, { type: 'FOCUS', customerId: 3 }).activeId).toBe(3);
    expect(stub.applyAction(THREE_CUSTOMERS, { type: 'FOCUS', customerId: 99 })).toBe(
      THREE_CUSTOMERS,
    );
  });

  it('R18 — SET_SLOT never rejects, so the builder may hold an invalid drink', () => {
    const held = stub.applyAction(MOOD_CALM, { type: 'SET_SLOT', slot: 'sugar', value: 'kosong' });
    expect(held.builder.sugar).toBe('kosong');
    // Every other slot carried over untouched — that is what `setSlot` promises.
    expect(held.builder.milk).toBe(PLAIN_KOPI.milk);
    expect(held.builder.base).toBe(PLAIN_KOPI.base);
    // Condensed milk with `kosong` is exactly what §7.3 excludes.
    expect(isValidDrink(held.builder)).toBe(false);
    // §8.2 — and it survives the passage of time.
    expect(stub.tick(held, REPLAY_STEP_MS).builder).toBe(held.builder);
  });

  it('R9 — the break card never auto-advances on an action, only on DISMISS_BREAK', () => {
    expect(stub.applyAction(MOOD_CALM, { type: 'DISMISS_BREAK' })).toBe(MOOD_CALM);
    expect(SHIFT_BREAK.phase).toBe('break');
    expect(stub.applyAction(SHIFT_BREAK, { type: 'DISMISS_BREAK' }).phase).toBe('gameover');
  });

  it('R19 — PAUSE is legal only from playing, RESUME only from paused', () => {
    expect(stub.applyAction(SHIFT_BREAK, { type: 'PAUSE' })).toBe(SHIFT_BREAK);
    expect(stub.applyAction(MOOD_CALM, { type: 'RESUME' })).toBe(MOOD_CALM);
    const paused = stub.applyAction(MOOD_CALM, { type: 'PAUSE' });
    expect(paused.phase).toBe('paused');
    expect(stub.applyAction(paused, { type: 'PAUSE' })).toBe(paused);
    // R19 composes with R5: the lockout is preserved across a pause, not consumed.
    const pausedUnderLockout = stub.applyAction(MID_LOCKOUT, { type: 'PAUSE' });
    expect(pausedUnderLockout.lockoutMs).toBe(MID_LOCKOUT.lockoutMs);
  });

  it('SERVE steps the replay rather than grading the order', () => {
    const calm = stub.tick(stub.createInitialState('daily', SEED), REPLAY_STEP_MS);
    expect(shapeOf(calm)).toBe('playing/calm');
    expect(shapeOf(stub.applyAction(calm, { type: 'SERVE' }))).toBe('playing/impatient');
    // Nothing was scored — M1a owns §8.8, and a stub that scored would be a
    // fiction a Track B test could go green against.
    expect(stub.applyAction(calm, { type: 'SERVE' }).score).toBe(calm.score);
  });
});
