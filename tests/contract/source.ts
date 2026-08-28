/**
 * Source-text support for the contract suite's static checks.
 *
 * Three assertions in this directory read `src/game/*.ts` as text rather than as
 * modules — the import boundary of `view.ts`, the same for `engine.ts`, and
 * §10.3's cast budget. Reading raw source means prose can trip a check that is
 * meant to be about code: a doc comment containing `from 'react'` is not an
 * import, and the words "treated as Drink" are not a cast.
 *
 * Everything below therefore works on lexed text. The scanner understands the
 * subset of TypeScript these four files use — both comment forms, and
 * single-quoted, double-quoted and template strings with backslash escapes. It
 * deliberately does *not* track regular-expression literals: none of the files
 * it is pointed at contains one, and if one appears the failure mode is a loud
 * check failure rather than a silent pass.
 */

/** Comments removed. `keepStrings` false also empties string literals. */
function scan(source: string, keepStrings: boolean): string {
  let out = '';
  let index = 0;
  /** The quote character of the string literal currently open, or `null`. */
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote !== null) {
      if (char === '\\') {
        // An escape consumes the next character whatever it is, so a `\'` can
        // never be mistaken for the end of the literal.
        if (keepStrings) out += char + (next ?? '');
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
        out += char;
      } else if (keepStrings) {
        out += char;
      } else if (char === '\n') {
        // Line structure is preserved even inside a template literal, so a
        // reported match keeps its line number.
        out += char;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n';
        index += 1;
      }
      index += 2;
      // A space, not nothing: an inline comment between two tokens must not
      // glue them into one.
      out += ' ';
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** The source with every comment removed and string literals left intact. */
export function stripComments(source: string): string {
  return scan(source, true);
}

/** The source with every comment removed and every string literal emptied. */
export function stripCommentsAndStrings(source: string): string {
  return scan(source, false);
}

/**
 * Every module specifier the given source imports or re-exports from, in source
 * order, read from code only.
 *
 * Covers all four forms that put a dependency into the module graph, which is
 * what §10.5's boundary is about: `import … from 'x'`, `export … from 'x'`,
 * `export * from 'x'` and the side-effect `import 'x'`.
 */
export function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const from = [...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const bare = [...code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  return [...from, ...bare];
}

/**
 * Every type assertion in the given source — the three syntaxes that spend
 * §10.3's cast budget.
 *
 * 1. `expr as T`, excluding `as const` (a literal-type widening ban, not a cast)
 *    and `as unknown as T`'s halves are each counted, which is correct: a double
 *    assertion spends more than one.
 * 2. `<T>expr`, the angle-bracket form. The lookbehind is what separates it from
 *    a generic *instantiation* — `deepFreeze<GameConfig>(…)`, `Record<K, V>` —
 *    where the `<` always follows an identifier, a `>` or a closing bracket.
 * 3. `expr!`, the non-null assertion. `!==` and a prefix `!` are excluded by
 *    requiring the `!` to follow the end of an expression and not precede `=`.
 *
 * A heuristic, not a parser — but a heuristic with a probe test in
 * `types.test.ts` asserting it recognises all three forms and none of the
 * look-alikes.
 */
export function castsIn(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  return [
    ...(code.match(/\bas\s+(?!const\b)[A-Za-z_$][\w$]*/g) ?? []),
    ...(code.match(/(?<![\w$>\])])<[A-Za-z_$][\w$.]*>\s*[A-Za-z_$(]/g) ?? []),
    ...(code.match(/[\w$)\]]!(?![=)\w])/g) ?? []),
  ];
}
