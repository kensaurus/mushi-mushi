// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/create-mushi-mushi/src/index.ts
 * PURPOSE: `npm create mushi-mushi` — an alias of `npx mushi-mushi`. npm passes
 *          the args that follow, and everything is forwarded to the same code
 *          in @mushi-mushi/cli/wizard-bin: the wizard, `--template` starters
 *          and `mushi` subcommands (ADR 0060 Phase 1b). Only the bin name,
 *          version and usage lines live here.
 */

import { runWizardBin } from '@mushi-mushi/cli/wizard-bin'

declare const __MUSHI_LAUNCHER_VERSION__: string | undefined

const VERSION: string =
  typeof __MUSHI_LAUNCHER_VERSION__ === 'string' ? __MUSHI_LAUNCHER_VERSION__ : '0.0.0-dev'

const USAGE = `create-mushi-mushi — same as npx mushi-mushi

Usage:
  npm create mushi-mushi                            run the setup wizard in this project
  npm create mushi-mushi -- --template vue my-app   scaffold a starter app (vue | svelte | node)
  npm create mushi-mushi -- --help                  show all flags

Note: \`npm create\` requires the \`--\` separator before flags.
      \`yarn create mushi-mushi --help\` works without it on Yarn 1.
      \`pnpm create mushi-mushi -- --help\` mirrors npm.
      \`bun create mushi-mushi --help\` works without it.`

void runWizardBin(process.argv.slice(2), { bin: 'create-mushi-mushi', version: VERSION, usage: USAGE })
