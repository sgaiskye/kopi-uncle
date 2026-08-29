/**
 * Enumeration support for the contract suite — deliberately **independent** of
 * `src/game/view.ts`.
 *
 * PRD §7.4 is verified by enumeration, so the assertions in `view.test.ts` are
 * only worth anything if the enumeration and the validity rule they check
 * against are not the same code being checked. The slot value lists and the
 * §7.3 predicate below are therefore written out from the PRD tables by hand;
 * `view.test.ts` asserts that `isValidDrink` agrees with `isValidPerSpec` on all
 * 288 raw combinations, which is a real cross-check rather than a tautology.
 *
 * Completeness of `SLOT_VALUES` is not left to inspection either: it is asserted
 * against the keys of `SLOT_VALUE_LABELS`, whose type forces one label per union
 * member, so a slot union that grew a value fails the suite.
 */
import type { Drink } from '../../src/game/types';

/** §7.1's slot values, in the PRD's table order. */
export const SLOT_VALUES = {
  base: ['kopi', 'teh'],
  milk: ['condensed', 'evaporated', 'none'],
  sugar: ['normal', 'siew-dai', 'ga-dai', 'kosong'],
  strength: ['normal', 'gao', 'po'],
  temperature: ['hot', 'peng'],
  vessel: ['cup', 'bag'],
} as const satisfies { [K in keyof Drink]: readonly Drink[K][] };

/** §7.2's canonical spoken order, which §7.5 also makes the enumeration order. */
export const SLOT_ORDER = [
  'base',
  'milk',
  'sugar',
  'strength',
  'temperature',
  'vessel',
] as const satisfies readonly (keyof Drink)[];

/**
 * §7.1's defaults. `base` has no default — it is always stated — so it is
 * absent here, which is also why §8.6 excludes it from the tier budget.
 */
export const SLOT_DEFAULTS = {
  milk: 'condensed',
  sugar: 'normal',
  strength: 'normal',
  temperature: 'hot',
  vessel: 'cup',
} as const satisfies Omit<{ [K in keyof Drink]: Drink[K] }, 'base'>;

/** §7.3, written out by hand so it can cross-check `view.isValidDrink`. */
export function isValidPerSpec(drink: Drink): boolean {
  if (drink.milk !== 'condensed') return true;
  return drink.sugar !== 'siew-dai' && drink.sugar !== 'kosong';
}

/** All 2 × 3 × 4 × 3 × 2 × 2 = 288 raw combinations, in §7.5's stable order. */
export const RAW_COMBINATIONS: readonly Drink[] = SLOT_VALUES.base.flatMap((base) =>
  SLOT_VALUES.milk.flatMap((milk) =>
    SLOT_VALUES.sugar.flatMap((sugar) =>
      SLOT_VALUES.strength.flatMap((strength) =>
        SLOT_VALUES.temperature.flatMap((temperature) =>
          SLOT_VALUES.vessel.map((vessel) => ({
            base,
            milk,
            sugar,
            strength,
            temperature,
            vessel,
          })),
        ),
      ),
    ),
  ),
);

/** The canonical 240 of §7.4, in the same stable order. */
export const VALID_DRINKS: readonly Drink[] = RAW_COMBINATIONS.filter(isValidPerSpec);
