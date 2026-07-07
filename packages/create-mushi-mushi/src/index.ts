// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/create-mushi-mushi/src/index.ts
 * PURPOSE: `npm create mushi-mushi` shim — npm passes the args that follow, and
 *          we forward them to the same wizard `mushi-mushi` runs. Lets users
 *          discover Mushi via the standard `npm create <name>` workflow. This
 *          ADDS Mushi to an existing project; it does not scaffold a new app.
 *
 *          Arg parsing, the Node-version guard, and the flags help are shared
 *          with the `mushi-mushi` launcher via `@mushi-mushi/cli/wizard-args`;
 *          only the bin name, header, and usage lines live here.
 */

import { runInit } from '@mushi-mushi/cli/init'
import {
  parseArgs,
  assertNodeVersion,
  FLAGS_HELP,
  type ParsedArgs,
} from '@mushi-mushi/cli/wizard-args'

declare const __MUSHI_LAUNCHER_VERSION__: string | undefined

const VERSION: string =
  typeof __MUSHI_LAUNCHER_VERSION__ === 'string' ? __MUSHI_LAUNCHER_VERSION__ : '0.0.0-dev'

const BIN = 'create-mushi-mushi'

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

const HELP = `create-mushi-mushi — add Mushi Mushi to your existing project

This does NOT scaffold a new app. It runs the setup wizard in your current
project: detects your framework and installs the right Mushi package.

Usage:
  npm create mushi-mushi                run the wizard
  npm create mushi-mushi -- --help      show all flags

Note: \`npm create\` requires the \`--\` separator before flags.
      \`yarn create mushi-mushi --help\` works without it on Yarn 1.
      \`pnpm create mushi-mushi -- --help\` mirrors npm.
      \`bun create mushi-mushi --help\` works without it.

${FLAGS_HELP}`

async function main(): Promise<void> {
  assertNodeVersion(BIN)

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  if (parsed.showHelp) {
    process.stdout.write(HELP + '\n')
    return
  }

  if (parsed.showVersion) {
    process.stdout.write(VERSION + '\n')
    return
  }

  await runInit({
    projectId: parsed.projectId,
    apiKey: parsed.apiKey,
    framework: parsed.framework,
    skipInstall: parsed.skipInstall,
    yes: parsed.yes,
    cwd: parsed.cwd,
    endpoint: parsed.endpoint,
    sendTestReport: parsed.skipTestReport ? false : undefined,
  })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`\n${BIN}: ${message}\n`)
  if (process.env.DEBUG?.includes('mushi') && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n')
  }
  process.stderr.write(`\nIf this is a bug, please report it at ${ISSUES_URL}\n`)
  process.exit(1)
})
