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

/** Every custom property declared by `tokens.css`, in declaration order. */
function customProperties(css: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    declared.set(match[1], match[2].trim());
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
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch|lab)\(/i.test(value),
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

  it('declares no §9.2 hex literal under src/ outside tokens.css', () => {
    const hexes = Object.values(PALETTE).map((hex) => hex.slice(1).toLowerCase());
    const pattern = new RegExp(`#(?:${hexes.join('|')})\\b`, 'gi');

    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((path) => path !== TOKENS_CSS)
      .flatMap((path) => {
        const matches = [...readFileSync(path, 'utf8').matchAll(pattern)].map((m) => m[0]);
        return matches.length === 0 ? [] : [`${relative(ROOT, path)}: ${matches.join(', ')}`];
      });

    expect(
      offenders,
      'every §9.2 colour reaches the tree through var(--token); a hex literal ' +
        'under src/ outside tokens.css is a copy that the contrast matrix above ' +
        'does not govern',
    ).toEqual([]);
  });

  it('has a grep that would actually catch one', () => {
    // The assertion above passes trivially if the pattern is wrong, so prove the
    // pattern matches the literals S1-2 inlined into TitleScreen.module.css.
    const hexes = Object.values(PALETTE).map((hex) => hex.slice(1).toLowerCase());
    const pattern = new RegExp(`#(?:${hexes.join('|')})\\b`, 'i');
    expect(pattern.test('  background-color: #fff3d6;')).toBe(true);
    expect(pattern.test('  color: #4A2C18;')).toBe(true);
    expect(pattern.test('  color: var(--teak);')).toBe(false);
  });

  it('finds every file under src/, so the sweep is not vacuous', () => {
    const found = sourceFiles(join(ROOT, 'src'));
    expect(found.length).toBeGreaterThan(10);
    expect(found).toContain(TOKENS_CSS);
    expect(found).toContain(join(ROOT, 'src/app/TitleScreen.module.css'));
  });
});
