/**
 * S9-1 — `src/dev/fixtures.ts`, the §10.5 catalogue the whole presentation track
 * develops against.
 *
 * Everything structural is asserted over `FIXTURES` rather than over a
 * hand-listed subset, so a fixture added by a later sprint cannot skip a check
 * by being forgotten. The four rulings that carry real arithmetic — §9.6's two
 * boundaries, R7 and R25's wrong-serve frame, and R16's truncated share grid —
 * get named tests of their own, and each recomputes its expectation from
 * `src/game/config.ts` rather than restating a §8 number (§10.4).
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/game/config';
import { isValidDrink, moodFor, nonDefaultCount } from '../../src/game/view';
import type { GameState, ServeResult } from '../../src/game/types';
import {
  AFTER_WALKOUT,
  EMPTY_QUEUE,
  FIXTURES,
  GAME_OVER,
  MID_LOCKOUT,
  MOOD_ANGRY,
  MOOD_BOUNDARY_ANGRY,
  MOOD_BOUNDARY_IMPATIENT,
  MOOD_CALM,
  MOOD_IMPATIENT,
  NO_ACTIVE,
  ONE_CUSTOMER,
  PLAIN_KOPI,
  POST_WRONG_SERVE,
  REPLAY_STEP_MS,
  SHIFT_BREAK,
  SHIFT_BREAK_CLEARED,
  THREE_CUSTOMERS,
  TIMELINE,
  TWO_CUSTOMERS,
} from '../../src/dev/fixtures';

const NAMED: [string, GameState][] = Object.entries(FIXTURES);

/** §8.9's Daily day, computed from the shift table rather than written as 34. */
const DAILY_CUSTOMERS = CONFIG.SHIFTS.reduce((total, shift) => total + shift.customers, 0);

/** Every millisecond field R20 requires to be an integer, flattened per fixture. */
function millisecondFields(state: GameState): [string, number][] {
  return [
    ['lockoutMs', state.lockoutMs],
    ['nextArrivalMs', state.nextArrivalMs],
    ['tickRemainderMs', state.tickRemainderMs],
    ...state.queue.flatMap((waiting): [string, number][] => [
      [`queue[${String(waiting.id)}].maxPatienceMs`, waiting.maxPatienceMs],
      [`queue[${String(waiting.id)}].patienceMs`, waiting.patienceMs],
    ]),
  ];
}

describe('the catalogue covers every §10.5 state', () => {
  it('is not vacuous — the exported map holds every named fixture', () => {
    expect(NAMED.length).toBe(Object.keys(FIXTURES).length);
    expect(NAMED.length).toBeGreaterThanOrEqual(16);
  });

  it('covers an empty queue, and one, two and three customers', () => {
    expect(EMPTY_QUEUE.queue).toHaveLength(0);
    expect(ONE_CUSTOMER.queue).toHaveLength(1);
    expect(TWO_CUSTOMERS.queue).toHaveLength(2);
    // §8.7's cap, read from config rather than spelled.
    expect(THREE_CUSTOMERS.queue).toHaveLength(CONFIG.QUEUE_CAP);
    expect(THREE_CUSTOMERS.nextArrivalMs).toBe(0); // R10 — arrivals suspended at the cap
  });

  it('covers each of the three §9.6 mood bands', () => {
    const bands = [MOOD_CALM, MOOD_IMPATIENT, MOOD_ANGRY].map((state) =>
      moodFor(state.queue[0].patienceMs, state.queue[0].maxPatienceMs),
    );
    expect(bands).toEqual(['calm', 'impatient', 'angry']);
  });

  it('covers active and no-active', () => {
    expect(ONE_CUSTOMER.activeId).not.toBeNull();
    expect(NO_ACTIVE.activeId).toBeNull();
    // A queue with nothing focused is the case that matters: an empty queue with
    // a null `activeId` would prove nothing about §9.5's expanded-card layout.
    expect(NO_ACTIVE.queue.length).toBeGreaterThan(0);
  });

  it('covers mid-lockout, immediately post-wrong-serve, break and gameover', () => {
    expect(MID_LOCKOUT.lockoutMs).toBeGreaterThan(0);
    expect(MID_LOCKOUT.lockoutMs).toBeLessThan(CONFIG.LOCKOUT_MS);
    expect(POST_WRONG_SERVE.lockoutMs).toBe(CONFIG.LOCKOUT_MS);
    expect(SHIFT_BREAK.phase).toBe('break');
    expect(SHIFT_BREAK_CLEARED.phase).toBe('break');
    expect(GAME_OVER.phase).toBe('gameover');
  });

  it('covers both R15 outcomes at the break card', () => {
    // Forfeited by the walkout.
    expect(SHIFT_BREAK.walkoutsInShift).toBeGreaterThan(0);
    expect(SHIFT_BREAK.frameEvents.some((event) => event.type === 'shiftCleared')).toBe(false);

    // Awarded: zero walkouts that shift.
    expect(SHIFT_BREAK_CLEARED.walkoutsInShift).toBe(0);
    expect(SHIFT_BREAK_CLEARED.frameEvents).toContainEqual({
      type: 'shiftCleared',
      shiftIndex: 0,
      bonus: CONFIG.SHIFT_CLEAR_BONUS,
    });
    expect(SHIFT_BREAK_CLEARED.score).toBeGreaterThanOrEqual(CONFIG.SHIFT_CLEAR_BONUS);
  });

  it('covers both modes', () => {
    const modes = new Set(NAMED.map(([, state]) => state.mode));
    expect([...modes].sort()).toEqual(['daily', 'endless']);
  });
});

describe('every fixture is structurally valid', () => {
  it.each(NAMED)('%s holds a queue within §8.7’s cap, ascending by id (R22)', (_name, state) => {
    expect(state.queue.length).toBeLessThanOrEqual(CONFIG.QUEUE_CAP);
    const ids = state.queue.map((waiting) => waiting.id);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(new Set(ids).size).toBe(ids.length);
    // R22's other half: id order is arrival order, so no queued id may have been
    // handed out at or past the next one.
    for (const id of ids) {
      expect(id).toBeLessThan(state.nextCustomerId);
    }
  });

  it.each(NAMED)('%s focuses null or a customer actually queued', (_name, state) => {
    if (state.activeId === null) return;
    expect(state.queue.map((waiting) => waiting.id)).toContain(state.activeId);
  });

  it.each(NAMED)('%s holds §8.8’s combo as an integer in range', (_name, state) => {
    for (const tenths of [state.comboTenths, state.bestComboTenths]) {
      expect(Number.isInteger(tenths)).toBe(true);
      expect(tenths).toBeGreaterThanOrEqual(CONFIG.COMBO_MIN_TENTHS);
      expect(tenths).toBeLessThanOrEqual(CONFIG.COMBO_MAX_TENTHS);
    }
    expect(state.bestComboTenths).toBeGreaterThanOrEqual(state.comboTenths);
  });

  it.each(NAMED)('%s carries integer milliseconds everywhere (R20)', (_name, state) => {
    for (const [field, value] of millisecondFields(state)) {
      expect(Number.isInteger(value), `${field} = ${String(value)}`).toBe(true);
      expect(value, `${field} is negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(NAMED)('%s keeps its counters coherent', (_name, state) => {
    expect(state.hearts).toBeGreaterThanOrEqual(0);
    expect(state.hearts).toBeLessThanOrEqual(CONFIG.HEARTS);
    expect(state.shiftIndex).toBeGreaterThanOrEqual(0);
    expect(state.shiftIndex).toBeLessThan(CONFIG.SHIFTS.length);
    // R25 — a correct serve is always also an attempt.
    expect(state.servesCorrect).toBeLessThanOrEqual(state.servesAttempted);
    expect(state.shiftResults.length).toBeGreaterThan(0);
    expect(Number.isInteger(state.score)).toBe(true);
  });

  it.each(NAMED)('%s carries a patience no greater than its maximum', (_name, state) => {
    for (const waiting of state.queue) {
      expect(waiting.maxPatienceMs).toBeGreaterThan(0);
      expect(waiting.patienceMs).toBeLessThanOrEqual(waiting.maxPatienceMs);
    }
  });

  it.each(NAMED)(
    '%s orders only drinks §7.3 permits, inside §8.6’s tier budget',
    (_name, state) => {
      for (const waiting of state.queue) {
        expect(isValidDrink(waiting.order), JSON.stringify(waiting.order)).toBe(true);
        // Every fixture customer is a breakfast customer, and breakfast is tier 1.
        expect(nonDefaultCount(waiting.order)).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each(NAMED)('%s is deeply frozen', (_name, state) => {
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.queue)).toBe(true);
    expect(Object.isFrozen(state.builder)).toBe(true);
    expect(Object.isFrozen(state.shiftResults)).toBe(true);
    expect(Object.isFrozen(state.frameEvents)).toBe(true);
    for (const waiting of state.queue) {
      expect(Object.isFrozen(waiting)).toBe(true);
    }
    for (const shift of state.shiftResults) {
      expect(Object.isFrozen(shift)).toBe(true);
    }
  });

  it('the freeze bites: a component that mutates a fixture throws', () => {
    const mutate = (): void => {
      MOOD_CALM.queue[0].patienceMs = 0;
    };
    expect(mutate).toThrow(TypeError);
    expect(MOOD_CALM.queue[0].patienceMs).toBeGreaterThan(0);
  });
});

describe('§9.6’s boundaries, resolved through view.moodFor and nowhere else', () => {
  it('p = 0.60 exactly is impatient, not calm', () => {
    const waiting = MOOD_BOUNDARY_IMPATIENT.queue[0];
    expect(moodFor(waiting.patienceMs, waiting.maxPatienceMs)).toBe('impatient');
    // Proof it is the boundary rather than merely inside the band: one more
    // millisecond of patience is the band above. No ratio is recomputed here —
    // `moodFor` answers both questions.
    expect(moodFor(waiting.patienceMs + 1, waiting.maxPatienceMs)).toBe('calm');
    expect(waiting.patienceMs / waiting.maxPatienceMs).toBe(3 / 5);
  });

  it('p = 0.30 exactly is angry, not impatient', () => {
    const waiting = MOOD_BOUNDARY_ANGRY.queue[0];
    expect(moodFor(waiting.patienceMs, waiting.maxPatienceMs)).toBe('angry');
    expect(moodFor(waiting.patienceMs + 1, waiting.maxPatienceMs)).toBe('impatient');
    expect(waiting.patienceMs / waiting.maxPatienceMs).toBe(3 / 10);
  });
});

describe('POST_WRONG_SERVE satisfies R7 and R25', () => {
  const before = MOOD_CALM.queue[0];
  const after = POST_WRONG_SERVE.queue[0];

  it('applies R7’s penalty to MOOD_CALM’s customer, floored', () => {
    expect(after.id).toBe(before.id);
    expect(after.maxPatienceMs).toBe(before.maxPatienceMs);
    expect(after.patienceMs).toBe(
      Math.max(
        Math.round(before.patienceMs - CONFIG.WRONG_SERVE_PENALTY_FRACTION * before.maxPatienceMs),
        CONFIG.PATIENCE_FLOOR_MS,
      ),
    );
    // The penalty actually bit, and R7's closing clause holds: a wrong serve can
    // never cause a walkout, so patience is still above the floor and above zero.
    expect(after.patienceMs).toBeLessThan(before.patienceMs);
    expect(after.patienceMs).toBeGreaterThanOrEqual(CONFIG.PATIENCE_FLOOR_MS);
  });

  it('marks the customer fumbled, so §8.9’s 🟨 is reachable', () => {
    expect(after.fumbled).toBe(true);
  });

  it('resets the combo, engages R5’s full lockout and leaves hearts alone', () => {
    expect(POST_WRONG_SERVE.comboTenths).toBe(CONFIG.COMBO_MIN_TENTHS);
    expect(POST_WRONG_SERVE.lockoutMs).toBe(CONFIG.LOCKOUT_MS);
    expect(POST_WRONG_SERVE.hearts).toBe(MOOD_CALM.hearts);
    expect(POST_WRONG_SERVE.hearts).toBe(CONFIG.HEARTS);
  });

  it('counts the attempt and not the serve (R25)', () => {
    expect(POST_WRONG_SERVE.servesAttempted).toBe(POST_WRONG_SERVE.servesCorrect + 1);
  });

  it('holds a builder R18 permits but the order rejects', () => {
    expect(POST_WRONG_SERVE.builder).not.toEqual(after.order);
    expect(POST_WRONG_SERVE.builder).not.toEqual(PLAIN_KOPI);
  });
});

describe('GAME_OVER satisfies R16', () => {
  const grid: readonly (readonly ServeResult[])[] = GAME_OVER.shiftResults;
  const flat = grid.flat();

  it('ends the run at zero hearts', () => {
    expect(GAME_OVER.hearts).toBe(0);
    expect(GAME_OVER.phase).toBe('gameover');
    expect(GAME_OVER.mode).toBe('daily');
    // R16 — customers still waiting are discarded and produce no result.
    expect(GAME_OVER.queue).toHaveLength(0);
    expect(GAME_OVER.activeId).toBeNull();
  });

  it('produces a share grid shorter than a full Daily day', () => {
    expect(DAILY_CUSTOMERS).toBe(34);
    expect(flat.length).toBeLessThan(DAILY_CUSTOMERS);
    expect(flat.length).toBeGreaterThan(0);
  });

  it('stays correctly grouped per shift (§8.9)', () => {
    expect(grid).toHaveLength(GAME_OVER.shiftIndex + 1);
    // Every shift the run finished is full-length; only the one it died in is short.
    for (let index = 0; index < GAME_OVER.shiftIndex; index += 1) {
      expect(grid[index], `shift ${String(index)}`).toHaveLength(CONFIG.SHIFTS[index].customers);
    }
    const final = grid[GAME_OVER.shiftIndex];
    expect(final.length).toBeGreaterThan(0);
    expect(final.length).toBeLessThan(CONFIG.SHIFTS[GAME_OVER.shiftIndex].customers);
    expect(final[final.length - 1]).toBe('walkout');
  });

  it('spends exactly one heart per walkout', () => {
    expect(flat.filter((glyph) => glyph === 'walkout')).toHaveLength(CONFIG.HEARTS);
  });

  it('reaches all three §8.9 glyphs, so the share grid renders every state', () => {
    expect([...new Set(flat)].sort()).toEqual(['clean', 'fumbled', 'walkout']);
  });

  it('announces itself in frameEvents (R21)', () => {
    expect(GAME_OVER.frameEvents).toContainEqual({ type: 'gameOver' });
    expect(GAME_OVER.frameEvents).toContainEqual({ type: 'heartLost', remaining: 0 });
  });
});

describe('the scripted replay’s shape', () => {
  it('walks calm → impatient → angry → walkout → break → gameover', () => {
    expect(TIMELINE.map((entry) => entry.name)).toEqual([
      'empty',
      'calm',
      'impatient',
      'angry',
      'walkout',
      'break',
      'gameover',
    ]);
  });

  it('spaces its entries by one config-derived step, ascending', () => {
    expect(REPLAY_STEP_MS).toBeGreaterThan(0);
    TIMELINE.forEach((entry, index) => {
      expect(entry.atMs).toBe(index * REPLAY_STEP_MS);
    });
  });

  it('carries its own cursor, so a fixture handed straight to the stub knows where it is', () => {
    for (const entry of TIMELINE) {
      expect(entry.state.tickRemainderMs, entry.name).toBe(entry.atMs);
    }
  });

  it('never walks R22’s id counter backwards, and never regains a heart', () => {
    TIMELINE.forEach((entry, index) => {
      if (index === 0) return;
      const previous = TIMELINE[index - 1].state;
      expect(entry.state.nextCustomerId, entry.name).toBeGreaterThanOrEqual(
        previous.nextCustomerId,
      );
      expect(entry.state.hearts, entry.name).toBeLessThanOrEqual(previous.hearts);
    });
  });

  it('draws every entry from the catalogue rather than inventing states', () => {
    const catalogue = new Set<GameState>(Object.values(FIXTURES));
    for (const entry of TIMELINE) {
      expect(catalogue.has(entry.state), entry.name).toBe(true);
    }
    // And the walkout entry is genuinely the walkout frame.
    expect(TIMELINE[4].state).toBe(AFTER_WALKOUT);
    expect(AFTER_WALKOUT.frameEvents).toContainEqual({ type: 'walkout', customerId: 1 });
    expect(AFTER_WALKOUT.frameEvents).toContainEqual({
      type: 'heartLost',
      remaining: CONFIG.HEARTS - 1,
    });
  });
});

describe('§10.4 — the catalogue reads its numbers from config', () => {
  it('takes every maxPatienceMs from patienceMsFor rather than from a literal', () => {
    const patiences = new Set(
      NAMED.flatMap(([, state]) => state.queue.map((waiting) => waiting.maxPatienceMs)),
    );
    expect(patiences.size).toBeGreaterThan(0);
    for (const patience of patiences) {
      expect(CONFIG.SHIFTS.map((shift) => shift.patienceMs)).toContain(patience);
    }
  });

  it('takes the lockout, the cap, the hearts and the bonus from CONFIG', () => {
    expect(POST_WRONG_SERVE.lockoutMs).toBe(CONFIG.LOCKOUT_MS);
    expect(THREE_CUSTOMERS.queue).toHaveLength(CONFIG.QUEUE_CAP);
    expect(EMPTY_QUEUE.hearts).toBe(CONFIG.HEARTS);
    expect(SHIFT_BREAK_CLEARED.score - CONFIG.SHIFT_CLEAR_BONUS).toBeGreaterThan(0);
  });

  it('takes the arrival gaps from gapMsFor', () => {
    const gaps = NAMED.map(([, state]) => state.nextArrivalMs).filter((gap) => gap > 0);
    expect(gaps.length).toBeGreaterThan(0);
    const shift = CONFIG.SHIFTS[0];
    for (const gap of gaps) {
      expect(gap).toBeLessThanOrEqual(shift.gapStartMs);
      expect(gap).toBeGreaterThanOrEqual(shift.gapEndMs);
    }
  });
});
