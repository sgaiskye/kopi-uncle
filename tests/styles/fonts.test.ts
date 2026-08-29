import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOKENS_CSS = join(ROOT, 'src/styles/tokens.css');
const TOKENS = readFileSync(TOKENS_CSS, 'utf8');

/**
 * PRD §9.3 — two roles, both bundled. Anton ships a single 400 weight; Nunito
 * Sans ships many and this project takes 400 and 700 only. Each entry is the
 * `@fontsource` specifier, the face it declares and the weight it carries, so a
 * swapped import (`latin.css` for the whole family, say, or a `latin-ext`
 * subset) fails rather than quietly tripling the font payload.
 */
const FACES = [
  { specifier: '@fontsource/anton/latin-400.css', family: 'Anton', weight: 400 },
  { specifier: '@fontsource/nunito-sans/latin-400.css', family: 'Nunito Sans', weight: 400 },
  { specifier: '@fontsource/nunito-sans/latin-700.css', family: 'Nunito Sans', weight: 700 },
] as const;

/** PRD §9.3's metric-compatible fallback stacks, verbatim. */
const STACKS = {
  '--font-family-display': "'Anton', 'Arial Narrow', system-ui, sans-serif",
  '--font-family-body': "'Nunito Sans', system-ui, -apple-system, sans-serif",
} as const;

/** The two hosts §3.3 forbids the built app from ever reaching for. */
const FONT_CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'] as const;

function imports(css: string): string[] {
  return [...css.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g)].map((match) => match[1]);
}

/** Collapses the whitespace Prettier is free to redistribute inside a value. */
function normalise(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function token(name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;{}]+);`).exec(TOKENS);
  expect(match, `src/styles/tokens.css declares no ${name}`).not.toBeNull();
  return normalise(match![1]);
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

describe('both faces are subset-imported from @fontsource', () => {
  it('imports exactly the three §9.3 subsets', () => {
    expect(imports(TOKENS)).toEqual(FACES.map((face) => face.specifier));
  });

  it('imports nothing from @fontsource beyond them', () => {
    // Catches a stray import anywhere in the file, including inside a block the
    // `imports()` sweep above would still see but an eye would not.
    const fontsource = [...TOKENS.matchAll(/@fontsource\/[A-Za-z0-9@/._-]+/g)].map((m) => m[0]);
    expect(new Set(fontsource)).toEqual(new Set(FACES.map((face) => face.specifier)));
  });

  it('takes the latin subset only, and no weight outside 400/700', () => {
    for (const specifier of imports(TOKENS)) {
      const file = specifier.split('/').pop();
      expect(file, `${specifier} does not name a subset file`).toMatch(/^latin-(?:400|700)\.css$/);
    }
  });

  it.each(FACES)('resolves $specifier to a real, self-hosted @font-face', (face) => {
    const path = join(ROOT, 'node_modules', face.specifier);
    expect(existsSync(path), `${face.specifier} is not installed`).toBe(true);

    const css = readFileSync(path, 'utf8');
    expect(css).toContain('@font-face');
    expect(css).toContain(`font-family: '${face.family}'`);
    expect(css).toContain(`font-weight: ${String(face.weight)}`);
    // §9.3 — a slow font load must shift no layout. This is `@fontsource`'s own
    // declaration and can only red if the package changes upstream; that `swap`
    // survives into the built stylesheet is asserted against the build below.
    expect(css).toContain('font-display: swap');
    expect(css).toContain('.woff2');

    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/['"]/g, ''));
    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.filter((url) => !url.startsWith('./')),
      `${face.specifier} must reference bundled files relatively (§3.3)`,
    ).toEqual([]);
  });
});

describe('the §9.3 fallback stacks', () => {
  it.each(Object.entries(STACKS))('declares %s exactly', (name, expected) => {
    expect(token(name)).toBe(expected);
  });

  it('names each imported family at the head of a stack', () => {
    const declared = Object.values(STACKS).join(' ');
    for (const family of new Set(FACES.map((face) => face.family))) {
      expect(declared).toContain(`'${family}'`);
    }
  });

  it('ends both stacks in a generic family', () => {
    for (const stack of Object.values(STACKS)) {
      expect(stack.split(',').pop()!.trim()).toBe('sans-serif');
    }
  });
});

/*
 * The criterion names `dist/`, and `--outDir` overrides `build.outDir`, so the
 * scratch build below could pass while the real one emitted somewhere else
 * entirely. This closes that: the build the gate and the deploy workflow run
 * writes `dist/assets/`, asserted against Vite's own resolved configuration
 * rather than against the text of `vite.config.ts`, so a `build.outDir` added
 * anywhere the config resolver reaches — a plugin, a mode-conditional branch —
 * reds here.
 */
describe('the configured build output', () => {
  it('resolves to dist/assets, which is what the criterion names', async () => {
    const { resolveConfig } = await import('vite');
    const config = await resolveConfig({ root: ROOT }, 'build');

    expect(resolve(ROOT, config.build.outDir), 'the production build must emit into dist/').toBe(
      join(ROOT, 'dist'),
    );
    expect(config.build.assetsDir, 'bundled assets — fonts included — live in assets/').toBe(
      'assets',
    );
  });
});

/*
 * §3.3 end to end: the production build must self-host every byte of both faces.
 *
 * Built into a scratch directory outside the repository rather than into
 * `dist/`, because `tests/scaffold/build.test.ts` spawns its own builds and
 * Vitest runs the two files concurrently — sharing `dist/` would have one
 * build's `emptyOutDir` delete the output the other is reading. It is the same
 * `npm run build` and the same `assetsDir`, and the assertion above pins where
 * an un-redirected build lands, so what this emits is what `dist/` gets.
 */
describe('the production build fetches no font at runtime', () => {
  let outDir = '';
  let built: string[] = [];

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'kopi-fonts-'));
    const result = spawnSync('npm', ['run', 'build', '--', '--outDir', outDir, '--emptyOutDir'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, `npm run build failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    built = filesIn(outDir);
  }, 180_000);

  afterAll(() => {
    if (outDir !== '') {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('emits an index document and an assets directory', () => {
    expect(built.length, 'the build emitted nothing').toBeGreaterThan(0);
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'assets'))).toBe(true);
  });

  it('references neither Google Fonts host anywhere in the output', () => {
    const offenders = built.flatMap((path) => {
      const text = readFileSync(path, 'latin1');
      const hits = FONT_CDN_HOSTS.filter((host) => text.includes(host));
      return hits.length === 0 ? [] : [`${relative(outDir, path)}: ${hits.join(', ')}`];
    });
    expect(
      offenders,
      'the game must play with the network disabled after first load (§3.3), so ' +
        'no built file may name a font CDN',
    ).toEqual([]);
  });

  it('emits every face into assets/ as a bundled file', () => {
    const fonts = filesIn(join(outDir, 'assets')).filter((path) => /\.woff2?$/.test(path));
    expect(fonts.length, 'no font file reached the build output').toBeGreaterThan(0);

    const names = fonts.map((path) => path.toLowerCase());
    for (const family of new Set(FACES.map((face) => face.family))) {
      const slug = family.toLowerCase().replace(/\s+/g, '-');
      expect(
        names.some((name) => name.includes(slug)),
        `${family} was imported but no ${slug} font file was emitted — Vite may ` +
          'have inlined it, or the import never reached the entry stylesheet',
      ).toBe(true);
    }

    // §9.3 takes three subsets; woff2 plus the woff fallback is two files each.
    expect(fonts.filter((path) => path.endsWith('.woff2')).length).toBe(FACES.length);
  });

  it('declares the @font-face rules in the built stylesheet', () => {
    const css = filesIn(join(outDir, 'assets'))
      .filter((path) => path.endsWith('.css'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(css.length, 'the build emitted no stylesheet').toBeGreaterThan(0);

    expect((css.match(/@font-face/g) ?? []).length).toBe(FACES.length);
    for (const family of new Set(FACES.map((face) => face.family))) {
      expect(css).toContain(family);
    }

    // §9.3's no-layout-shift promise is only kept if `swap` reaches the browser:
    // every emitted face must carry it, and none may carry anything else. The
    // minifier removes the whitespace, so match on the property, not the text.
    const displays = [...css.matchAll(/font-display\s*:\s*([a-z-]+)/gi)].map((match) =>
      match[1].toLowerCase(),
    );
    expect(
      displays.length,
      'no font-display survived into the built stylesheet, so a slow font load ' +
        'blocks text rather than swapping (§9.3)',
    ).toBe(FACES.length);
    expect(new Set(displays)).toEqual(new Set(['swap']));
    // The tokens themselves have to survive the bundle, or nothing downstream
    // can resolve var(--teak).
    expect(css).toContain('--teak');
    expect(css).toContain('--step-28');
  });
});
