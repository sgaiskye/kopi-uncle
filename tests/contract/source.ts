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
 * subset of TypeScript these four files use — both comment forms; single-quoted,
 * double-quoted and template strings with backslash escapes; and
 * regular-expression literals, including character classes and the `/` a
 * character class is allowed to contain.
 *
 * Regular-expression literals earn their place in that list even though none of
 * the four files currently holds one. `/['"]/` is an ordinary regex, and to a
 * scanner that did not know better its quote opens a string literal that never
 * closes — swallowing the rest of the file and turning every check downstream
 * into a silent pass. S16 puts `parseOrder(text)` in `grammar.ts`, which is
 * exactly where that shape appears. A recognised regex has its body emptied for
 * every caller: no check here reads one, and `/from 'react'/` is not an import
 * any more than `/document/` is the DOM.
 *
 * Where the scanner is nonetheless out of its depth the failure mode is a thrown
 * error, and therefore a loud check failure rather than a silent pass: `scan`
 * refuses to return with a string or a regex literal still open. That is the
 * backstop for the one ambiguity a character-by-character scanner cannot
 * resolve — whether a `/` divides or opens a regex — which `startsRegex` decides
 * from the preceding token. A wrong guess in the "regex" direction runs to the
 * end of the line and throws instead of quietly mangling what follows.
 */

/**
 * Keywords after which a `/` opens a regular-expression literal rather than
 * dividing. `return /re/.test(text)` is the shape that matters for the files
 * this is pointed at; the rest are listed so the rule is about JavaScript and
 * not about today's four files.
 */
const REGEX_AFTER_KEYWORD = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/**
 * Whether the `/` about to be read opens a regular-expression literal, decided
 * from the last significant character of the code already emitted.
 *
 * A `/` divides only when it follows something an expression can end with: an
 * identifier or number, a `)`, a `]`, or a closing quote. Every other position
 * (`=`, `(`, `,`, `:`, `return`, the start of the file) expects an operand, so a
 * `/` there opens a regex.
 */
function startsRegex(emitted: string): boolean {
  // Only the tail matters, and a bare `/` is rare enough in these files that
  // slicing per occurrence costs nothing.
  const before = emitted.trimEnd().slice(-64);
  if (before === '') return true;
  const last = before[before.length - 1];
  if (!/[\w$)\]'"`]/.test(last)) return true;
  const identifier = /[A-Za-z_$][\w$]*$/.exec(before);
  return identifier !== null && REGEX_AFTER_KEYWORD.has(identifier[0]);
}

/**
 * Comments removed and regex bodies emptied. `keepStrings` false also empties
 * string literals.
 *
 * Throws rather than returning a truncated scan: see this module's header.
 */
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

    if (char === '/' && startsRegex(out)) {
      const start = index;
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < source.length) {
        const inner = source[index];
        if (inner === '\\') {
          index += 2;
          continue;
        }
        // A regex literal cannot span a line, so a newline means this `/` was
        // not one. Leaving `closed` false hands it to the throw below.
        if (inner === '\n') break;
        if (inClass) {
          if (inner === ']') inClass = false;
        } else if (inner === '[') {
          inClass = true;
        } else if (inner === '/') {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) {
        throw new Error(
          `unterminated regular-expression literal at offset ${start}: the scanner read a ` +
            '`/` as opening a regex. Teach `startsRegex` about this position rather than ' +
            'letting a truncated scan pass silently.',
        );
      }
      // Trailing flags belong to the literal.
      while (index < source.length && /[a-z]/.test(source[index] ?? '')) index += 1;
      // Emptied in both modes, unlike a string. `keepStrings` exists for the one
      // consumer that must read a literal's text — `importSpecifiers`, reading a
      // module specifier — and no check reads a regex body: `/from 'react'/` is
      // not an import, `/document/` is not the DOM and `/Date.now/` is not a
      // clock. The space keeps the two delimiters from reading as a comment.
      out += '/ /';
      continue;
    }

    out += char;
    index += 1;
  }

  if (quote !== null) {
    throw new Error(
      `unterminated ${quote === '`' ? 'template' : 'string'} literal: the scan is out of step ` +
        'with the source, and every check reading its output would pass vacuously. Fix the ' +
        'scanner rather than trusting the result.',
    );
  }

  return out;
}

/**
 * The source with every comment removed, every regex body emptied, and string
 * literals left intact.
 */
export function stripComments(source: string): string {
  return scan(source, true);
}

/**
 * The source with every comment removed and every string and regex literal
 * emptied.
 */
export function stripCommentsAndStrings(source: string): string {
  return scan(source, false);
}

/**
 * The globals §10.5 keeps out of the game core. The DOM is reached through
 * these rather than through imports, so the import boundary alone does not
 * hold it out.
 */
export const DOM_GLOBALS = ['document', 'window', 'navigator', 'localStorage'];

/**
 * Which of `DOM_GLOBALS` the given source reaches for *in code*.
 *
 * The single place the denylist's lens is chosen, and the reason this lives
 * here rather than twice over in `view.test.ts` and `engine.test.ts`: both of
 * those files run their check *and* its positive control through this one
 * function, so narrowing the lens back to `stripComments` — leaving string
 * literals in place — reds those controls instead of passing silently.
 *
 * Comments and string literals are both stripped because neither is an access:
 * prose about the rule is not the DOM, and neither is a thrown message that
 * names it. `view.ts` and `engine.ts` are files Sprint 15 and Sprint 21 rewrite
 * without owning the tests that read them, so a check that reds on the word is
 * a landmine those sprints could not defuse.
 */
export function domGlobalsIn(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  return DOM_GLOBALS.filter((global) => new RegExp(`\\b${global}\\b`).test(code));
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
 * Whether an `<T>` match opens the type-parameter list of a generic arrow
 * function — `<T>(x: T) => x` — rather than an angle-bracket cast.
 *
 * Both begin `<T>(`, so the two are told apart by what follows the closing `)`:
 * a generic arrow's parameter list is followed by `=>`, optionally through a
 * return-type annotation. A cast of a parenthesised expression, `<Drink>(value)`,
 * is followed by anything else.
 */
function isGenericArrow(code: string, matchIndex: number, match: string): boolean {
  let index = matchIndex + match.length - 1;
  if (code[index] !== '(') return false;
  let depth = 0;
  for (; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    else if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // An unbalanced `(` runs `index` to the end of the input, where the slice is
  // empty and the test below fails — so a truncated parameter list is not an
  // arrow, with no separate arm to say so.
  return /^\s*(:[^;={}\n]*)?=>/.test(code.slice(index + 1));
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
 *    `isGenericArrow` is what separates it from a generic arrow *declaration*,
 *    `<T>(x: T) => x`, which introduces a type parameter rather than asserting
 *    one.
 * 3. `expr!`, the non-null assertion. `!==` and a prefix `!` are excluded by
 *    requiring the `!` to follow the end of an expression. A `!` before a `)` is
 *    counted: `foo(x!)` spends the budget exactly as `const y = x!` does.
 *
 * A heuristic, not a parser — but a heuristic with a probe test in
 * `types.test.ts` asserting it recognises all three forms and none of the
 * look-alikes, over a scanner with probes of its own in `source.test.ts`.
 */
export function castsIn(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  return [
    ...(code.match(/\bas\s+(?!const\b)[A-Za-z_$][\w$]*/g) ?? []),
    ...[...code.matchAll(/(?<![\w$>\])])<[A-Za-z_$][\w$.]*>\s*[A-Za-z_$(]/g)]
      .filter((match) => !isGenericArrow(code, match.index, match[0]))
      .map((match) => match[0]),
    ...(code.match(/[\w$)\]]!(?![=\w])/g) ?? []),
  ];
}
