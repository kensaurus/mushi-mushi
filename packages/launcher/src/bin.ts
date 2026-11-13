// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/launcher/src/bin.ts
 * PURPOSE: Unscoped `mushi-mushi` bin — thin shim over `@mushi-mushi/cli`.
 *          Lets users run any CLI command without remembering the scope:
 *
 *          - `npx mushi-mushi`                       → runs the wizard
 *          - `npx mushi-mushi init [...]`            → runs the wizard with flags
 *          - `npx mushi-mushi --template vue my-app` → scaffolds a starter app
 *          - `npx mushi-mushi <cmd> [...]`           → forwarded verbatim to
 *            `@mushi-mushi/cli`'s `mushi` bin (setup, login, status, etc.)
 *
 *          All of that lives in `@mushi-mushi/cli/wizard-bin`, shared with
 *          `create-mushi-mushi`; only the bin name, version and usage lines
 *          live here.
 */

import { runWizardBin } from '@mushi-mushi/cli/wizard-bin'

declare const __MUSHI_LAUNCHER_VERSION__: string | undefined

const VERSION: string =
  typeof __MUSHI_LAUNCHER_VERSION__ === 'string' ? __MUSHI_LAUNCHER_VERSION__ : '0.0.0-dev'

// runWizardBin appends the shared flags help, which already ends with the
// Node requirement and the Docs/Console footer; don't repeat it here.
const USAGE = `mushi-mushi — bug-reporting SDK launcher

Usage:
  npx mushi-mushi                        run the setup wizard (interactive)
  npx mushi-mushi --yes                  same, taking the defaults (required in CI and AI-agent shells)
  npx mushi-mushi init                   same, with optional flags
  npx mushi-mushi --template vue my-app  scaffold a starter app (vue | svelte | node)

Other commands (setup, status, reports, deploy, test, login, config, ...)
are forwarded to @mushi-mushi/cli, e.g. \`npx mushi-mushi setup --ide cursor\`.`

void runWizardBin(process.argv.slice(2), { bin: 'mushi-mushi', version: VERSION, usage: USAGE })
