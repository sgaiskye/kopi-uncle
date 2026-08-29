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

/*
 * ---------------------------------------------------------------------------
 * S7-1 / S7-2 (Sprint 7 — Boundary and purity lint)
 * ---------------------------------------------------------------------------
 *
 * PRD §10.5 splits the build into a logic track and a presentation track that
 * meet at exactly one three-part seam — `src/game/types`, `src/game/view`, and
 * the three engine signatures reached only through `src/app/EngineContext.tsx`.
 * §12.1 rates "the two tracks diverge and M2 integration is expensive" as the
 * top risk, and the mitigation named there is this file: the boundary is
 * enforced in *both* directions by lint rather than by convention.
 *
 * PRD §3 constraint 7 adds the purity half — no wall clock and no ambient
 * randomness inside `src/game/`. §10.5 is explicit that `no-restricted-globals`
 * is the wrong mechanism for it: `Date.now()`, `performance.now()` and
 * `Math.random()` are member expressions, so that rule catches only
 * `setTimeout` and silently misses all three. The bans below are therefore
 * `no-restricted-syntax` AST selectors matching the `CallExpression >
 * MemberExpression` shape.
 *
 * **The fixture globs are load-bearing.** `no-restricted-imports` and
 * `no-restricted-syntax` are path-scoped, so S7-3's four deliberately-illegal
 * fixtures can only be proven to trip them if the globs reach the fixtures'
 * *real* on-disk paths. `tests/lint/fixtures/game-*` and
 * `tests/lint/fixtures/component-*` are therefore covered by the same
 * overrides as `src/game/**` and `src/components/**` — that naming convention
 * is what makes the fixtures live proof rather than decoration, and renaming a
 * fixture out of it would make it pass and prove nothing.
 */

/** S7-3's fixture directory. Globally ignored below; see that entry's note. */
const LINT_FIXTURES = 'tests/lint/fixtures';

/** The logic track: PRD §10.2's pure core, plus S7-3's `game-*` fixtures. */
const GAME_FILES = ['src/game/**/*.{ts,tsx}', `${LINT_FIXTURES}/game-*.{ts,tsx}`];

/** The presentation track, plus S7-3's `component-*` fixture. */
const PRESENTATION_FILES = [
  'src/components/**/*.{ts,tsx}',
  'src/graphics/**/*.{ts,tsx}',
  `${LINT_FIXTURES}/component-*.{ts,tsx}`,
];

/** §10.5's "one indirection owns the swap" — the sole permitted importer. */
const ENGINE_INDIRECTION = 'src/app/EngineContext.tsx';

/**
 * The two implementations of the engine contract, banned everywhere under
 * `src/` except `ENGINE_INDIRECTION`.
 *
 * Import specifiers are matched as written, gitignore-style, and never
 * resolved — so both the cross-directory form (`../game/engine`, which the
 * globstar patterns catch) and the sibling form (`./engine` from inside
 * `src/game/`) have to be spelled out. Missing the sibling form would leave
 * the logic track free to reach the engine through a relative import, which is
 * precisely the coupling §10.5 exists to prevent.
 */
const ENGINE_GROUP = {
  group: [
    '**/game/engine',
    '**/game/engine.*',
    '**/dev/stubEngine',
    '**/dev/stubEngine.*',
    './engine',
    './engine.*',
    './stubEngine',
    './stubEngine.*',
  ],
  message:
    'PRD §10.5: `src/app/EngineContext.tsx` is the only module that may name ' +
    '`src/game/engine` or `src/dev/stubEngine`. Take state as props or read ' +
    '`useEngine()`, so M2 swapping the stub for the engine stays a one-file change.',
};

/** The `no-restricted-imports` configuration for the logic track (S7-1). */
const GAME_IMPORT_BANS = [
  'error',
  {
    patterns: [
      {
        group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
        message:
          'PRD §10.5: the logic track never imports React. `src/game/` must stay ' +
          'importable in Node with no browser globals — that is what makes an entire ' +
          'shift a pure fold and keeps §10.7 100% coverage reachable.',
      },
      {
        group: [
          '**/components',
          '**/components/**',
          '**/graphics',
          '**/graphics/**',
          '**/app',
          '**/app/**',
          '**/dev',
          '**/dev/**',
          '**/storage',
          '**/storage/**',
        ],
        message:
          'PRD §10.5: the logic track never imports from `components/`, `graphics/`, ' +
          '`app/`, `dev/` or `storage/`. The seam runs the other way — presentation ' +
          'imports `game/types` and `game/view`, never the reverse.',
      },
      {
        group: ['*.css', '**/*.css'],
        message:
          'PRD §10.5: the logic track never imports a stylesheet. `src/game/` must be ' +
          'importable in Node with no bundler and no browser globals (§10.2).',
      },
      ENGINE_GROUP,
    ],
  },
];

/**
 * The `no-restricted-imports` configuration for the presentation track (S7-1).
 *
 * The negations are the seam: everything under `game/` is denied, then
 * `types` and `view` are handed back. Gitignore semantics take the *last*
 * matching pattern, so the exceptions have to follow the ban.
 *
 * A bare `game` (no trailing globstar) is deliberately absent from the group.
 * Under gitignore semantics an excluded *directory* cannot be re-included by a
 * later negation, so adding it would silently re-ban `game/types` and
 * `game/view` and make the seam unusable — verified against the `ignore`
 * matcher ESLint builds from this group. §10.2 ships no `src/game/` barrel for
 * it to guard, so nothing is lost.
 */
const PRESENTATION_IMPORT_BANS = [
  'error',
  {
    patterns: [
      {
        group: [
          '**/game/**',
          '!**/game/types',
          '!**/game/types.*',
          '!**/game/view',
          '!**/game/view.*',
        ],
        message:
          'PRD §10.5: the presentation track imports exactly two modules out of ' +
          '`src/game/` — `types` and `view`. Everything else, the three engine ' +
          'signatures included, arrives through `src/app/EngineContext.tsx`.',
      },
      ENGINE_GROUP,
    ],
  },
];

/**
 * The `no-restricted-syntax` configuration for the logic track (S7-2).
 *
 * The first three are member expressions and the reason `no-restricted-globals`
 * cannot be the mechanism (§10.5). The last three are bare identifiers, matched
 * as identifiers rather than as calls so that `const t = setTimeout` is caught
 * alongside `setTimeout(...)`.
 */
const PURITY_MESSAGE =
  'PRD §3 constraint 7: no wall clock and no ambient randomness inside `src/game/`. ' +
  'Time arrives as `dtMs` on `tick` — R20 quantises it into whole `TICK_MS` steps ' +
  'and carries the remainder in `tickRemainderMs` — and randomness arrives as ' +
  '`rngState` inside `GameState`. Both are inputs, never ambient reads.';

const PURITY_SELECTORS = [
  'error',
  {
    selector: "CallExpression > MemberExpression[object.name='Date'][property.name='now']",
    message: `\`Date.now()\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
  {
    selector: "CallExpression > MemberExpression[object.name='performance'][property.name='now']",
    message: `\`performance.now()\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
  {
    selector: "CallExpression > MemberExpression[object.name='Math'][property.name='random']",
    message: `\`Math.random()\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
  {
    selector: "Identifier[name='setTimeout']",
    message: `\`setTimeout\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
  {
    selector: "Identifier[name='setInterval']",
    message: `\`setInterval\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
  {
    selector: "Identifier[name='requestAnimationFrame']",
    message: `\`requestAnimationFrame\` is banned in \`src/game/\`. ${PURITY_MESSAGE}`,
  },
];

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
      //
      // **That test must construct its `ESLint` with `ignore: false`.** This
      // entry is a *global* ignore, and `lintFiles()` skips a globally-ignored
      // path outright: it returns one "File ignored because of a matching
      // ignore pattern" message with a `null` `ruleId` and no rule messages at
      // all. Every `ruleId` assertion in `tests/lint/boundary.test.ts` would
      // then fail with an empty list and a misleading cause. Do not resolve
      // that by un-ignoring the fixtures — this entry is what keeps the gate
      // green over four deliberately illegal files, and S7-3 requires it.
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

  // S7-3's fixtures are outside tsconfig's `include`, so `projectService` has
  // no program for them and the type-aware layer would report a fatal parsing
  // error instead of a rule message — which would defeat the whole point of
  // committing them. The two rules that must fire on them are purely
  // syntactic, so the program is simply not needed here.
  {
    ...tseslint.configs.disableTypeChecked,
    name: 'kopi/lint-fixtures-untyped',
    files: [`${LINT_FIXTURES}/**/*.{ts,tsx}`],
  },

  // §10.5's "one indirection owns the swap", over the whole of `src/`. This is
  // first of the three `no-restricted-imports` blocks because flat config
  // *replaces* a rule's options rather than merging them: the two track blocks
  // below re-declare the rule for their own files, so each of them carries
  // `ENGINE_GROUP` itself. Order this after them and the logic track's bans
  // would be silently wiped.
  {
    name: 'kopi/engine-indirection',
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [ENGINE_GROUP] }],
    },
  },

  // The logic track: no React, no presentation, no stylesheets, no clock.
  {
    name: 'kopi/game-boundary',
    files: GAME_FILES,
    rules: {
      'no-restricted-imports': GAME_IMPORT_BANS,
      'no-restricted-syntax': PURITY_SELECTORS,
    },
  },

  // The presentation track: `game/types` and `game/view`, and nothing else.
  {
    name: 'kopi/presentation-seam',
    files: PRESENTATION_FILES,
    rules: {
      'no-restricted-imports': PRESENTATION_IMPORT_BANS,
    },
  },

  // The one exemption, and the reason every block above can be absolute.
  // `EngineContext.tsx` is the module §10.5 designates to name both
  // implementations; the tree-wide grep in `tests/lint/seam.test.ts` is what
  // stops this exemption from quietly widening to a second file.
  {
    name: 'kopi/engine-indirection-exemption',
    files: [ENGINE_INDIRECTION],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Deliberately last. See the header note.
  prettier,
];
