import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOKENS_CSS = join(ROOT, 'src/styles/tokens.css');
const TOKENS = readFileSync(TOKENS_CSS, 'utf8');

/**
 * PRD §9.2 is the source of truth for these six values, and this file restates
 * them once so that a token edited to a different colour fails here rather than
 * silently diverging from the document. Everything below — the type scale, the
 * contrast matrix, the forbidden pairs — is computed from the values parsed out
 * of `tokens.css`, never from this table.
 *
 * Compared case-insensitively: Prettier lowercases hex colours in CSS, so the
 * committed file reads `#0e6b4f` where the PRD writes `#0E6B4F`. Same colour,
 * and the formatter is not negotiable.
 */
const PALETTE = {
  '--kopitiam-green': '#0E6B4F',
  '--tile-teal': '#2A9D8F',
  '--kaya-yellow': '#F4B93E',
  '--chilli-red': '#D62828',
  '--condensed-cream': '#FFF3D6',
  '--teak': '#4A2C18',
} as const;

/** PRD §9.3's type scale, in px. */
const TYPE_SCALE = {
  '--step-12': 12,
  '--step-14': 14,
  '--step-16': 16,
  '--step-20': 20,
  '--step-28': 28,
  '--step-40': 40,
  '--step-64': 64,
} as const;

/** Collapses the whitespace Prettier is free to redistribute inside a value. */
function normalise(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Every custom property declared by `tokens.css`, in declaration order. */
function customProperties(css: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    declared.set(match[1], normalise(match[2]));
  }
  return declared;
}

const DECLARED = customProperties(TOKENS);

function token(name: string): string {
  const value = DECLARED.get(name);
  expect(value, `src/styles/tokens.css declares no ${name}`).toBeDefined();
  return value!;
}

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(match, `expected a six-digit hex colour, got "${hex}"`).not.toBeNull();
  const value = match![1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = '#FFFFFF';

/** The AA floor for body text — PRD §9.7. */
const AA_FLOOR = 4.5;

describe('src/styles/tokens.css — the §9.2 palette', () => {
  it.each(Object.entries(PALETTE))('declares %s as %s', (name, expected) => {
    expect(token(name).toLowerCase()).toBe(expected.toLowerCase());
  });

  it('declares no colour token beyond those six', () => {
    // "Exactly the six custom properties" of §9.2: any *other* custom property
    // holding a raw colour is a seventh palette entry by another name, and the
    // approved-pair matrix below would not cover it.
    const extras = [...DECLARED.entries()]
      .filter(([name]) => !(name in PALETTE))
      .filter(([, value]) =>
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch|oklab|lab|lch|color)\(/i.test(value),
      )
      .map(([name]) => name);
    expect(
      extras,
      'every colour in the tree resolves through §9.2, so a colour-valued token ' +
        'outside the six needs a row in §9.2 and this matrix first',
    ).toEqual([]);
  });
});

describe('src/styles/tokens.css — the §9.3 type scale', () => {
  it.each(Object.entries(TYPE_SCALE))('declares %s as %ipx', (name, px) => {
    expect(token(name)).toBe(`${px}px`);
  });

  it('declares no step outside the seven-value scale', () => {
    const steps = [...DECLARED.keys()].filter((name) => name.startsWith('--step-'));
    expect(steps.sort()).toEqual(Object.keys(TYPE_SCALE).sort());
  });

  it('names each step for the pixel value it carries', () => {
    // So `--step-28` can never quietly become 24px: §9.3 pins the active order
    // text to "28px or larger" by naming the token, not by reading its value.
    for (const name of Object.keys(TYPE_SCALE)) {
      expect(token(name)).toBe(`${name.replace('--step-', '')}px`);
    }
  });
});

describe('the §9.2 contrast matrix', () => {
  /** The only foreground/background pairings §9.2 permits for text. */
  const APPROVED: ReadonlyArray<readonly [string, string, number, string]> = [
    ['--teak', '--condensed-cream', 11.44, 'body text, labels, order text'],
    ['--teak', '--kaya-yellow', 7.12, 'score, combo, active slot'],
    [WHITE, '--kopitiam-green', 6.49, 'primary button labels'],
    ['--condensed-cream', '--kopitiam-green', 5.89, 'header text'],
    [WHITE, '--chilli-red', 5.01, 'error text'],
    ['--chilli-red', '--condensed-cream', 4.54, 'last heart, angry band'],
  ];

  /**
   * §9.2's exclusions, and the reason this matrix exists: kaya-on-cream at
   * 1.61:1 shipped in PRD v1.0 and failed AA outright. If either of these ever
   * clears the floor, a token has been edited and the "never as text on cream"
   * rulings that follow from them are no longer sound.
   */
  const FORBIDDEN: ReadonlyArray<readonly [string, string, number]> = [
    ['--kaya-yellow', '--condensed-cream', 1.61],
    ['--tile-teal', '--condensed-cream', 3.01],
  ];

  function colour(nameOrHex: string): string {
    return nameOrHex.startsWith('--') ? token(nameOrHex) : nameOrHex;
  }

  it.each(APPROVED)('%s on %s measures %f:1 — %s', (fg, bg, expected) => {
    const ratio = contrastRatio(colour(fg), colour(bg));
    expect(ratio).toBeCloseTo(expected, 2);
    expect(Math.abs(ratio - expected)).toBeLessThanOrEqual(0.01);
    expect(ratio).toBeGreaterThanOrEqual(AA_FLOOR);
  });

  it.each(FORBIDDEN)('%s on %s fails AA at %f:1', (fg, bg, expected) => {
    const ratio = contrastRatio(colour(fg), colour(bg));
    expect(Math.abs(ratio - expected)).toBeLessThanOrEqual(0.01);
    expect(
      ratio,
      'this pair is forbidden for text by §9.2; if it now clears AA the palette ' +
        'has changed and the table needs re-deriving',
    ).toBeLessThan(AA_FLOOR);
  });

  it('computes ratios the WCAG reference values agree with', () => {
    // Anchors, so a broken luminance implementation cannot make the matrix pass
    // by measuring everything at once.
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', WHITE)).toBeCloseTo(4.48, 2);
  });

  it('is symmetric, so a row cannot pass by being written backwards', () => {
    for (const [fg, bg] of APPROVED) {
      expect(contrastRatio(colour(fg), colour(bg))).toBeCloseTo(
        contrastRatio(colour(bg), colour(fg)),
        10,
      );
    }
  });

  it('rejects anything that is not a six-digit hex colour', () => {
    expect(() => luminance('teal')).toThrow();
    expect(() => luminance('#fff')).toThrow();
  });
});

/*
 * "No §9.2 hex literal outside tokens.css" is the criterion, but a hex literal
 * is only one of the ways CSS can spell a colour. The sweep below reduces every
 * notation it meets to 8-bit sRGB channels and compares those, so re-spelling
 * cream as `#fff3d6ff`, `rgb(255 243 214)`, `hsl(42.44 100% 91.96%)` or
 * `oklch(96.61% 0.04 88.2)` is caught the same way the plain hex is. A colour
 * that is *not* in §9.2 is never flagged, so `rgba(0, 0, 0, 0.2)` for a shadow
 * stays legal.
 *
 * Not covered, and deliberately: `lab()`, `lch()`, `color()` and `color-mix()`,
 * whose conversions need a CIE white point this sweep has no reason to carry.
 * `oklch()`/`oklab()` are covered because they are the notations a formatter or
 * a design tool actually emits today.
 */
const COLOUR_NOTATION = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]*\)/gi;

type Channels = readonly [number, number, number];

function clamp255(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Linear-light sRGB to an 8-bit channel. */
function gammaEncode(linear: number): number {
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return clamp255(encoded * 255);
}

/** A functional notation's arguments, comma-, space- or slash-separated. */
function notationArgs(notation: string): string[] {
  const inner = notation.slice(notation.indexOf('(') + 1, notation.lastIndexOf(')'));
  return inner.split(/[\s,/]+/).filter((part) => part !== '');
}

/** A component that may be written as a percentage of `full`. */
function scalar(text: string, full: number): number {
  return text.endsWith('%') ? (Number.parseFloat(text) / 100) * full : Number.parseFloat(text);
}

/** A 0–1 component that CSS also permits as a percentage. */
function fraction(text: string): number {
  if (text.endsWith('%')) {
    return Number.parseFloat(text) / 100;
  }
  const value = Number.parseFloat(text);
  return value > 1 ? value / 100 : value;
}

function degrees(text: string): number {
  const value = Number.parseFloat(text);
  if (/turn$/i.test(text)) {
    return value * 360;
  }
  if (/rad$/i.test(text)) {
    return (value * 180) / Math.PI;
  }
  if (/grad$/i.test(text)) {
    return value * 0.9;
  }
  return value;
}

/** Any hex form — 3, 4, 6 or 8 digits; the alpha digits are dropped. */
function hexChannels(hex: string): Channels | null {
  const digits = hex.slice(1);
  const expanded =
    digits.length === 3 || digits.length === 4 ? [...digits].map((d) => d + d).join('') : digits;
  if (expanded.length !== 6 && expanded.length !== 8) {
    return null;
  }
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(expanded.slice(i, i + 2), 16));
  return [r, g, b];
}

/** CSS Color 4's HSL-to-RGB, hue in degrees, saturation and lightness in 0–1. */
function hslChannels(hue: number, saturation: number, lightness: number): Channels {
  const component = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const [r, g, b] = [component(0), component(8), component(4)].map((v) => clamp255(v * 255));
  return [r, g, b];
}

/** Oklab to sRGB — Ottosson's matrices, anchored by the tests below. */
function oklabChannels(L: number, a: number, b: number): Channels {
  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const [r, g, blue] = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map(gammaEncode);
  return [r, g, blue];
}

/** One colour notation as 8-bit sRGB channels, or null if unrecognised. */
function channelsOf(notation: string): Channels | null {
  if (notation.startsWith('#')) {
    return hexChannels(notation);
  }
  const name = notation.slice(0, notation.indexOf('(')).toLowerCase();
  const parts = notationArgs(notation);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !/^[+-]?[\d.]/.test(part))) {
    return null;
  }
  switch (name) {
    case 'rgb':
    case 'rgba': {
      const [r, g, b] = parts.slice(0, 3).map((part) => clamp255(scalar(part, 255)));
      return [r, g, b];
    }
    case 'hsl':
    case 'hsla':
      return hslChannels(degrees(parts[0]), fraction(parts[1]), fraction(parts[2]));
    case 'oklab':
      return oklabChannels(fraction(parts[0]), scalar(parts[1], 0.4), scalar(parts[2], 0.4));
    case 'oklch': {
      const chroma = scalar(parts[1], 0.4);
      const hue = (degrees(parts[2]) * Math.PI) / 180;
      return oklabChannels(fraction(parts[0]), chroma * Math.cos(hue), chroma * Math.sin(hue));
    }
    default:
      return null;
  }
}

/**
 * The §9.2 token whose colour this is, within one 8-bit step — the slack covers
 * rounding through another colour space, and nothing in §9.2 sits within one
 * step of anything else.
 */
function paletteTokenFor(channels: Channels): string | null {
  for (const [name, hex] of Object.entries(PALETTE)) {
    const target = hexChannels(hex);
    if (target !== null && channels.every((value, i) => Math.abs(value - target[i]) <= 1)) {
      return name;
    }
  }
  return null;
}

/** Every §9.2 colour spelled literally in `text`, in any notation. */
function paletteLiterals(text: string): string[] {
  return [...text.matchAll(COLOUR_NOTATION)].flatMap((match) => {
    const notation = match[0];
    const parsed = channelsOf(notation);
    if (parsed === null) {
      return [];
    }
    const name = paletteTokenFor(parsed);
    return name === null ? [] : [`${notation} (${name})`];
  });
}

describe('the §9.2 palette is declared in exactly one place', () => {
  const SKIP_DIRS = new Set(['node_modules']);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      if (SKIP_DIRS.has(entry)) {
        return [];
      }
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : [path];
    });
  }

  it('spells no §9.2 colour under src/ outside tokens.css, in any notation', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((path) => path !== TOKENS_CSS)
      .flatMap((path) => {
        const hits = paletteLiterals(readFileSync(path, 'utf8'));
        return hits.length === 0 ? [] : [`${relative(ROOT, path)}: ${hits.join(', ')}`];
      });

    expect(
      offenders,
      'every §9.2 colour reaches the tree through var(--token); a literal under ' +
        'src/ outside tokens.css is a copy that the contrast matrix above does ' +
        'not govern, whichever notation it is written in',
    ).toEqual([]);
  });

  it('has a sweep that would actually catch one, in any notation', () => {
    // The assertion above passes trivially if the sweep is wrong, so prove it
    // catches the literals S1-2 inlined into TitleScreen.module.css and the
    // re-spellings a `\b`-anchored hex grep used to walk straight past.
    const caught = [
      '  background-color: #fff3d6;',
      '  color: #4A2C18;',
      '  background: #fff3d6ff;',
      '  background: #FFF3D680;',
      '  background: rgb(255, 243, 214);',
      '  background: rgb(255 243 214 / 50%);',
      '  background: rgba(255, 243, 214, 0.5);',
      '  color: hsl(42.44 100% 91.96%);',
      '  color: oklch(96.61% 0.04 88.2);',
      '  color: oklab(0.9661 0.0013 0.04);',
      "  const outline = '#0e6b4f';",
    ];
    for (const line of caught) {
      expect(paletteLiterals(line), `not caught: ${line}`).not.toEqual([]);
    }

    // A colour that is not in §9.2 is not this sweep's business.
    const ignored = [
      '  color: var(--teak);',
      '  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);',
      '  background: #ffffff;',
      '  color: hsl(210 20% 40%);',
      '  color: oklch(50% 0.1 200);',
      '  font-size: var(--step-12);',
    ];
    for (const line of ignored) {
      expect(paletteLiterals(line), `wrongly caught: ${line}`).toEqual([]);
    }
  });

  it('reads every notation the sweep claims to', () => {
    // Anchors for the conversions above, so a broken matrix cannot make the
    // sweep pass by mapping everything to the same wrong colour. The oklch and
    // oklab values are sRGB red as CSS Color 4 publishes it.
    expect(channelsOf('#fff')).toEqual([255, 255, 255]);
    expect(channelsOf('#ff000080')).toEqual([255, 0, 0]);
    expect(channelsOf('rgb(1 2 3)')).toEqual([1, 2, 3]);
    expect(channelsOf('rgb(100%, 0%, 0%)')).toEqual([255, 0, 0]);
    expect(channelsOf('hsl(120 100% 50%)')).toEqual([0, 255, 0]);
    expect(channelsOf('hsl(0.5turn 100% 50%)')).toEqual([0, 255, 255]);
    expect(channelsOf('oklch(1 0 0)')).toEqual([255, 255, 255]);
    expect(channelsOf('oklch(0 0 0)')).toEqual([0, 0, 0]);
    expect(channelsOf('oklch(62.8% 0.2577 29.23)')).toEqual([255, 0, 0]);
    expect(channelsOf('oklab(0.628 0.2249 0.1258)')).toEqual([255, 0, 0]);
    expect(channelsOf('#12345')).toBeNull();
    expect(channelsOf('lab(50% 40 59.5)')).toBeNull();
  });

  it('finds every file under src/, so the sweep is not vacuous', () => {
    const found = sourceFiles(join(ROOT, 'src'));
    expect(found.length).toBeGreaterThan(10);
    expect(found).toContain(TOKENS_CSS);
    expect(found).toContain(join(ROOT, 'src/app/TitleScreen.module.css'));
  });
});
