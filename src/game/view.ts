/**
 * Part 2 of §10.5's three-part track seam: a barrel of **pure display helpers**,
 * implemented for real in M0 rather than stubbed.
 *
 * A stub that merely typechecks would unblock nothing. Patience rings, mood
 * faces and slot rows are all functions of a `Drink` or of two numbers, so
 * Track B can render a queue card on day one against this file and an
 * `src/dev/` fixture, with no engine in existence.
 *
 * Three constraints hold for the life of this module:
 *
 * - **Six exports, exactly.** `formatOrder`, `isValidDrink`, `nonDefaultCount`,
 *   `moodFor`, `SLOT_ROW_LABELS`, `SLOT_VALUE_LABELS`. Nothing else may leak
 *   into the seam; `tests/contract/view.test.ts` compares a namespace import's
 *   sorted keys to that list.
 * - **No engine, no React, no DOM** anywhere in this module's import graph — the
 *   only import is the type surface. Sprint 7's `no-restricted-imports`
 *   boundary rule is written against exactly this shape.
 * - **`moodFor` is the one place the patience ratio is computed** (§9.6).
 *   Neither track re-derives it, so the three face states and the ring can
 *   never disagree about which band a customer is in.
 *
 * M1a *extends* `grammar.ts` and re-exports through here; it never rewrites what
 * this file freezes.
 */
import type { Drink, Mood } from './types';

/** One entry per member of each slot's union — the type forces completeness. */
type PerSlotValue<V> = { readonly [K in keyof Drink]: Readonly<Record<Drink[K], V>> };

/**
 * §7.1's spoken forms. The empty string marks a **default**, which §7.1 says the
 * customer leaves unstated, so `formatOrder` drops it. `base` has no default —
 * it is always stated — and is capitalised because it opens the order.
 */
const SPOKEN: PerSlotValue<string> = {
  base: { kopi: 'Kopi', teh: 'Teh' },
  milk: { condensed: '', evaporated: 'C', none: 'O' },
  sugar: { normal: '', 'siew-dai': 'siew dai', 'ga-dai': 'ga dai', kosong: 'kosong' },
  strength: { normal: '', gao: 'gao', po: 'po' },
  temperature: { hot: '', peng: 'peng' },
  vessel: { cup: '', bag: 'da bao' },
};

/**
 * §7.1's defaults, for the five modifier slots §8.6 counts against the tier
 * budget. `base` is absent because it has none.
 */
const DEFAULTS = {
  milk: 'condensed',
  sugar: 'normal',
  strength: 'normal',
  temperature: 'hot',
  vessel: 'cup',
} as const satisfies Omit<Drink, 'base'>;

/** §9.6's band boundaries. Both are half-open upward: `p` equal to either falls
 * into the *lower* band, so every boundary is decidable. */
const CALM_ABOVE = 0.6;
const IMPATIENT_ABOVE = 0.3;

/**
 * §7.2's canonical spoken order — `Base → Milk → Sugar → Strength →
 * Temperature → Vessel` — with every default omitted.
 *
 * The slots are read out longhand rather than by iterating a key list, because
 * §7.2's order is the contract and this is the one place it is written down.
 */
export function formatOrder(drink: Drink): string {
  const spoken = [
    SPOKEN.base[drink.base],
    SPOKEN.milk[drink.milk],
    SPOKEN.sugar[drink.sugar],
    SPOKEN.strength[drink.strength],
    SPOKEN.temperature[drink.temperature],
    SPOKEN.vessel[drink.vessel],
  ];
  return spoken.filter((word) => word !== '').join(' ');
}

/**
 * §7.3's single validity rule, and nothing else: **condensed milk cannot combine
 * with `siew-dai` or `kosong`**, because condensed milk is itself sweetened and
 * its sweetness is not adjustable downward. `ga-dai` is valid with any milk.
 *
 * This excludes 48 of the 288 raw combinations, leaving §7.4's 240.
 *
 * Note R18: the builder may legally *hold* a drink this rejects. Serving one is
 * simply a wrong serve — the generator only ever emits valid drinks — so nothing
 * here blocks input.
 */
export function isValidDrink(drink: Drink): boolean {
  if (drink.milk !== 'condensed') return true;
  return drink.sugar !== 'siew-dai' && drink.sugar !== 'kosong';
}

/**
 * How many of the five modifier slots sit away from their §7.1 default, 0..5.
 * **`base` is excluded** — it is always stated, so §8.6 never charges it against
 * the tier budget.
 *
 * Written as a list of comparisons rather than as branches so there is no
 * unreachable arm to cover, and so §7.4's histogram
 * (`{0: 2, 1: 14, 2: 46, 3: 82, 4: 72, 5: 24}`) falls out of arithmetic.
 */
export function nonDefaultCount(drink: Drink): number {
  const changed = [
    drink.milk !== DEFAULTS.milk,
    drink.sugar !== DEFAULTS.sugar,
    drink.strength !== DEFAULTS.strength,
    drink.temperature !== DEFAULTS.temperature,
    drink.vessel !== DEFAULTS.vessel,
  ];
  return changed.filter(Boolean).length;
}

/**
 * §9.6's three face states, from the patience ratio `p = patienceMs /
 * maxPatienceMs`:
 *
 * | State | Condition |
 * |---|---|
 * | `calm` | `p > 0.60` |
 * | `impatient` | `0.30 < p ≤ 0.60` |
 * | `angry` | `p ≤ 0.30` |
 *
 * The intervals are half-open and **both boundary values belong to the lower
 * band**, which is what makes the boundary decidable rather than a rounding
 * accident. §9.6 makes this the *only* place the ratio is computed: the ring and
 * the face are two renderings of one number, so neither track re-derives it.
 *
 * **Ruled for `maxPatienceMs <= 0`** (§13's never-ask instruction, S3-3): return
 * `'angry'`. No `config.ts` patience is ever zero or negative, so this is not
 * reachable from the engine — but this function is on the frozen seam and a
 * fixture or a partially-initialised card may call it with anything. Dividing
 * would yield `NaN`, `Infinity` or `-Infinity`, each of which falls through
 * every `>` comparison to a band chosen by accident; `'angry'` is the safe band
 * and keeps the return total.
 */
export function moodFor(patienceMs: number, maxPatienceMs: number): Mood {
  if (!(maxPatienceMs > 0)) return 'angry';
  const p = patienceMs / maxPatienceMs;
  if (p > CALM_ABOVE) return 'calm';
  if (p > IMPATIENT_ABOVE) return 'impatient';
  return 'angry';
}

/** §9.5's six wireframe row labels, keyed in §7.2's order. */
export const SLOT_ROW_LABELS: Readonly<Record<keyof Drink, string>> = Object.freeze({
  base: 'BASE',
  milk: 'MILK',
  sugar: 'SUGAR',
  strength: 'BREW',
  temperature: 'TEMP',
  vessel: 'TAKE',
});

/**
 * A label for every one of the 16 slot values (2 + 3 + 4 + 3 + 2 + 2), using
 * §7.1's spoken form wherever one exists — `C`, `O`, `siew dai`, `ga dai`,
 * `kosong`, `gao`, `po`, `peng`, `da bao` — and the plain word otherwise.
 *
 * The five defaults get a real word rather than §9.5's `●` glyph: the glyph is a
 * visual treatment for the button, while this is the accessible name a screen
 * reader has to be able to say (§9.7). Labels are unique within their slot.
 *
 * The mapped type forces one label per union member, so a slot union that grew a
 * value fails typecheck here rather than rendering a blank button.
 */
export const SLOT_VALUE_LABELS: PerSlotValue<string> = Object.freeze({
  base: Object.freeze({ kopi: 'kopi', teh: 'teh' }),
  milk: Object.freeze({ condensed: 'condensed', evaporated: 'C', none: 'O' }),
  sugar: Object.freeze({
    normal: 'normal',
    'siew-dai': 'siew dai',
    'ga-dai': 'ga dai',
    kosong: 'kosong',
  }),
  strength: Object.freeze({ normal: 'normal', gao: 'gao', po: 'po' }),
  temperature: Object.freeze({ hot: 'hot', peng: 'peng' }),
  vessel: Object.freeze({ cup: 'cup', bag: 'da bao' }),
});
