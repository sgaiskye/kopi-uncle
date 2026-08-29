/**
 * Probes for `./source`, the scanner the contract suite's three static checks
 * read `src/game/*.ts` through.
 *
 * The scanner is the one piece of this directory whose failures are silent by
 * construction: a check that greps lexed text and finds nothing cannot tell
 * "clean file" from "the lexer stopped reading at line 40". Its own module
 * header claims that where it is out of its depth the failure mode is "a loud
 * check failure rather than a silent pass", and a claim like that is worth
 * exactly as much as the test that holds it. Hence this file — probes for the
 * constructs that made the claim false, and for the throw that now makes it
 * true.
 *
 * `types.test.ts` probes `castsIn`'s three cast forms; this file probes the
 * lexing underneath it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { castsIn, importSpecifiers, stripComments, stripCommentsAndStrings } from './source';

describe('the scanner reads regular-expression literals as literals', () => {
  it('does not let a quote inside a regex open a string that never closes', () => {
    // The shape that mattered: a scanner that does not know regexes reads the
    // `'` as opening a string literal, runs to the end of the file without
    // finding a partner for it, and returns everything after it as string
    // content. `castsIn` then reported an empty list and §10.3's budget check
    // passed on a file that had spent it.
    const source = ['const QUOTED = /[\'"]/;', 'const spent = value as Drink;', ''].join('\n');
    expect(castsIn(source)).toEqual(['as Drink']);
    // The scan itself reaches the second line rather than swallowing it.
    expect(stripCommentsAndStrings(source)).toContain('const spent = value as Drink;');
    expect(stripComments(source)).toContain('const spent = value as Drink;');
  });

  it('reads the whole literal — escaped slashes, character classes and flags', () => {
    for (const literal of [
      String.raw`/https?:\/\//`, // an escaped `/` does not close the literal
      '/[/]/', // nor does one inside a character class
      String.raw`/[\]/]/`, // nor one after an escaped `]` still inside the class
      "/it's/gi", // a lone quote, then flags
      '/"/u',
    ]) {
      const source = `const RE = ${literal};\nconst spent = value as Drink;\n`;
      expect(castsIn(source), literal).toEqual(['as Drink']);
    }
  });

  it('empties the body, so a regex is not mistaken for an import, the DOM or a clock', () => {
    // A regex body is a literal, not code. Every consumer of the scanner greps
    // for code, so none of them should see inside one.
    const source = [
      "const FROM = /from 'react'/;",
      'const DOM = /document|window/;',
      'const CLOCK = /Date\\.now/;',
      "import type { Drink } from './types';",
      '',
    ].join('\n');
    expect(importSpecifiers(source)).toEqual(['./types']);
    const code = stripComments(source);
    expect(code).not.toMatch(/\bdocument\b/);
    expect(code).not.toContain('Date.now');
    // And the code around the literals survives, so this is not passing by
    // truncation.
    expect(code).toContain('const CLOCK =');
    expect(code).toContain("import type { Drink } from './types';");
  });

  it('still reads a division as a division', () => {
    // The other half of the ambiguity. Were any of these read as opening a
    // regex, the scan would run to the end of the line and throw — so `toBe`
    // below is a real assertion about the decision, not just about the output.
    for (const division of [
      'const half = total / count;',
      'const half = (a + b) / 2;',
      'const half = values[0] / 2;',
      'const half = size() / 2;',
      'const half = 6 / 2;',
    ]) {
      expect(stripComments(`${division}\n`), division).toBe(`${division}\n`);
    }
  });

  it('reads a regex where an operand is expected, including after a keyword', () => {
    for (const source of [
      'export function f(t: string) {\n  return /kopi/.test(t);\n}\n',
      'const found = list.filter((t) => /kopi/.test(t));\n',
      'if (typeof /kopi/ === "object") return;\n',
    ]) {
      // Reaches the end without throwing, and the body is gone.
      expect(stripComments(source), source.trim()).not.toContain('kopi');
    }
  });
});

describe('the scanner fails loudly rather than returning a truncated scan', () => {
  it('throws on a string or template literal left open', () => {
    // The residual risk the module header describes. A silent truncation here
    // would make every downstream check vacuous, so it is not allowed to return.
    expect(() => stripComments("const s = 'oops;\n")).toThrow(/unterminated string literal/);
    expect(() => stripComments('const s = "oops;\n')).toThrow(/unterminated string literal/);
    expect(() => stripComments('const s = `oops;\n')).toThrow(/unterminated template literal/);
    expect(() => stripCommentsAndStrings("const s = 'oops;\n")).toThrow(/unterminated string/);
  });

  it('throws when a `/` it read as a regex has no partner on the line', () => {
    // `startsRegex` guesses from the preceding token, and a wrong guess in the
    // "regex" direction is the one way the scan can still go wrong. It ends in a
    // throw, not in a mangled tail.
    expect(() => stripComments('const bad = / 2;\n')).toThrow(
      /unterminated regular-expression literal/,
    );
    // And the checks built on it inherit the throw rather than an empty result —
    // which is the whole of the module header's claim.
    expect(() => castsIn('const bad = / 2;\nconst spent = value as Drink;\n')).toThrow(
      /unterminated regular-expression literal/,
    );
    expect(() => importSpecifiers("const bad = / 2;\nimport './types';\n")).toThrow(
      /unterminated regular-expression literal/,
    );
  });
});

describe('the scanner still does what it did before regexes were in it', () => {
  it('removes both comment forms and keeps line structure', () => {
    const source = [
      '// a leading line comment',
      '/*',
      ' * a block',
      ' */',
      'const a = 1;',
      '',
    ].join('\n');
    const code = stripComments(source);
    expect(code).not.toContain('leading line comment');
    expect(code).not.toContain('a block');
    expect(code).toContain('const a = 1;');
    // One output line per input line, so a match keeps its line number.
    expect(code.split('\n').length).toBe(source.split('\n').length);
  });

  it('keeps string bodies for `stripComments` and empties them otherwise', () => {
    const source = "const message = 'counts as Drink';\n";
    expect(stripComments(source)).toBe(source);
    expect(stripCommentsAndStrings(source)).toBe("const message = '';\n");
  });

  it('does not let an escaped quote end a literal', () => {
    const source = "const message = 'it\\'s fine';\nconst spent = value as Drink;\n";
    expect(castsIn(source)).toEqual(['as Drink']);
  });
});

/**
 * What the scanner is pointed at, asserted as a property of this directory
 * rather than left to be read off four files.
 *
 * The lexer is a heuristic, and the one ambiguity it cannot resolve from the
 * left — whether a `/` divides or opens a regex — is decided by `startsRegex`.
 * That decision is right for the shapes the three files it reads contain, and
 * it is not claimed to be right for every shape in the language: S16's
 * `parseOrder` regexes in `grammar.ts` are exactly the sort of input a
 * token-blind guesser can get wrong, and a wrong guess throws (loudly, by
 * design — but in a test file `grammar.ts`'s sprint does not own).
 *
 * The hole closes by aim rather than by cleverness. The lexer reads three named
 * files: `types.ts` for §10.3's cast budget, and `view.ts` and `engine.ts` for
 * their §10.5 import boundaries. Nothing else under `src/game/` is lexed, and
 * that is asserted here so a future glob cannot re-open it silently.
 */
describe('the scanner is aimed at three named files, not at src/game/**', () => {
  const CONTRACT_DIR = fileURLToPath(new URL('.', import.meta.url));
  const GAME_DIR = fileURLToPath(new URL('../../src/game/', import.meta.url));
  const SELF = basename(fileURLToPath(import.meta.url));

  /** Every file in this directory that imports the scanner. */
  const consumers = readdirSync(CONTRACT_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({ file: entry, text: readFileSync(join(CONTRACT_DIR, entry), 'utf8') }))
    .filter(({ text }) => /from '\.\/source'/.test(text));

  /** `src/game/` files a consumer loads as text — the idiom all three use. */
  const aimedAt = new Set(
    consumers.flatMap(({ text }) =>
      [...text.matchAll(/new URL\('\.\.\/\.\.\/src\/game\/([\w.-]+)'/g)].map((match) => match[1]),
    ),
  );

  it('is imported by exactly the three static checks, plus these probes', () => {
    expect(consumers.map(({ file }) => file).sort()).toEqual([
      'engine.test.ts',
      SELF,
      'types.test.ts',
      'view.test.ts',
    ]);
  });

  it('reads types.ts, view.ts and engine.ts, and nothing else under src/game/', () => {
    expect([...aimedAt].sort()).toEqual(['engine.ts', 'types.ts', 'view.ts']);
    // Not vacuous: `src/game/` holds more than the three, and the file it holds
    // today that is deliberately not lexed is named so the gap is visible.
    const present = readdirSync(GAME_DIR).filter((entry) => entry.endsWith('.ts'));
    expect(present).toContain('config.ts');
    expect([...aimedAt]).not.toContain('config.ts');
    expect(present.length).toBeGreaterThan(aimedAt.size);
  });

  it('has no consumer that enumerates src/game/, which is how a fourth file would be lexed', () => {
    // The cast budget was globbed over the directory until S3.1-2. A glob is
    // the only way an unnamed file reaches the lexer, so both of its spellings
    // are banned outright. These probes are exempt: they read the directory to
    // make this very assertion, and they lex nothing from it.
    for (const { file, text } of consumers.filter(({ file: name }) => name !== SELF)) {
      expect(text, file).not.toContain('readdirSync');
      expect(text, file).not.toContain("../../src/game/'");
    }
  });
});
