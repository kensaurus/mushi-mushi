// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/launcher/src/eslint.ts
 * PURPOSE: `mushi-mushi/eslint` — the Mushi Mushi ESLint rules (empty
 *          handlers, mock data left in production code). The workspace
 *          package eslint-plugin-mushi-mushi is a devDependency and is bundled
 *          into this entry at build time (tsup noExternal); eslint itself is an
 *          optional peer. Flat config only:
 *
 *            import mushi from 'mushi-mushi/eslint'
 *            export default [mushi.configs.recommended]
 *
 *          or `import { recommended } from 'mushi-mushi/eslint'`. `recommended`
 *          is read off the same plugin object (not the plugin's own
 *          /recommended entry, which bundles a second copy), so using both in
 *          one config never hits ESLint's "Cannot redefine plugin".
 */
import type { Linter } from 'eslint'
import plugin from 'eslint-plugin-mushi-mushi'

/** The `recommended` flat config: `mushi.configs.recommended`. */
export const recommended = plugin.configs.recommended as Linter.Config

export default plugin
