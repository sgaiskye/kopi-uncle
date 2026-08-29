/**
 * S7-3 fixture — **this file must FAIL lint.**
 *
 * The logic→presentation half of PRD §10.5's boundary: `src/game/` is the pure
 * core, importable in Node with no browser globals, so it may not reach for
 * React, a component, or a stylesheet. Every import below is banned by the
 * `no-restricted-imports` override in `eslint.config.js`.
 *
 * It is committed deliberately broken and is kept out of `npm run lint`'s file
 * set (a global `ignores` entry) and out of `npm run typecheck` (tsconfig's
 * `exclude`). `tests/lint/boundary.test.ts` lints it through the ESLint Node
 * API — with `ignore: false`, which is the only way a globally-ignored path
 * yields rule messages rather than a single "File ignored" notice.
 *
 * Do not "fix" this file.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SlotRow } from '../../../src/components/slots/SlotRow';
import styles from '../../../src/app/GameScreen.module.css';

export const probe = { useState, createRoot, SlotRow, styles };
