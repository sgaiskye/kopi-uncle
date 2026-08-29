import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier/flat';

/**
 * ESLint 9 flat config — S2-1 (Sprint 2 — ESLint 9, type-aware).
 *
 * Type-aware from the start, because PRD §10.5's seam rules land in Sprint 7
 * (S7-1, S7-2) and several of them are undecidable without a program: the
 * wall-clock ban has to recognise `Date.now()` as a member expression on the
 * real `Date`, and `no-floating-promises` cannot exist at all without types.
 * Turning the analysis on later would mean re-running the whole gate against a
 * stricter linter mid-build.
 *
 * Prettier is a formatter, not a lint rule. `eslint-plugin-prettier` is
 * deliberately not installed — routing formatting through lint turns every
 * reformat into a gate failure with a stack trace attached — and
 * `eslint-config-prettier` is the **last entry of this array** so that any
 * stylistic rule an earlier entry switches on is switched back off. Last wins
 * in a flat config, so the linter can never fight `npm run format`.
 */

/** Everything tsconfig type-checks, which is everything under `src/` and `tests/`. */
const TS_FILES = ['**/*.ts', '**/*.tsx'];

/** Plain JavaScript: this config, and the two gate-stage scripts. */
const JS_FILES = ['**/*.js', '**/*.mjs', '**/*.cjs'];

/** Where React actually lives — PRD §10.2's `app/` screens and `components/` clusters. */
const REACT_FILES = ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'];

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Planning documents and vendored agent skills are not this project's
      // code, matching `.prettierignore`.
      'docs/**',
      '.claude/**',
      // S7-3 commits files here that MUST fail lint, proving the §10.5
      // boundary rules bite. They are outside tsconfig's `include` and outside
      // `npm run lint`'s file set so the gate stays green with deliberately
      // illegal files committed; the boundary test lints them through the
      // ESLint Node API against this config instead.
      'tests/lint/fixtures/**',
    ],
  },

  js.configs.recommended,

  // Type-aware TypeScript. `projectService` resolves each file through
  // tsconfig.json rather than a hand-maintained `project` list, so a new
  // directory added by a later sprint needs no edit here.
  ...tseslint.config({
    files: TS_FILES,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }),

  // `.js`/`.mjs` files are outside tsconfig, so the type-checked rules must not
  // reach them — without this the parser would fail on a file with no program.
  {
    files: JS_FILES,
    ...tseslint.configs.disableTypeChecked,
  },

  // Node globals for the plain-JavaScript files, and *only* for them.
  //
  // `globals` exists to feed `no-undef`, and `no-undef` is off for every
  // `.ts`/`.tsx` file: typescript-eslint's `eslint-recommended` layer, pulled
  // in by `recommendedTypeChecked` above, disables it because `tsc` already
  // proves the same thing with better information. So a `globals.browser`
  // block over `src/app/**` would resolve to nothing enforceable, and an
  // earlier revision of this file carried one with a comment claiming it kept
  // browser globals out of `src/game/` per PRD §10.2. It did not — a probe in
  // `src/game/` reading `window.innerWidth` linted clean through it. That
  // boundary is S7-1's, enforced with `no-restricted-imports` over the module
  // graph, which is the only mechanism that can actually check it.
  //
  // `no-undef` *is* live for `.js`/`.mjs`, so this block is the one that bites.
  {
    files: JS_FILES,
    languageOptions: { globals: globals.node },
  },

  // React hook rules, scoped to where React lives.
  //
  // Only the two rules PRD §10.1's stack actually needs are enabled. The rest
  // of the plugin's v7 `recommended` set is React-Compiler analysis whose
  // findings would land in files this sprint does not own and cannot fix, and
  // two of them ship at `warn`, which `--max-warnings 0` turns into a gate
  // failure. A later sprint that wants them adds them here.
  {
    files: REACT_FILES,
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // The plugin default is `warn`; the gate has no warning budget, so say
      // `error` and mean it.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Deliberately last. See the header note.
  prettier,
];
