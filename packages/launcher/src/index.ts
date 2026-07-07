// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/launcher/src/index.ts
 * PURPOSE: Unscoped `mushi-mushi` bin — thin shim that delegates to
 *          `@mushi-mushi/cli`'s `init` command. Lets users run the wizard
 *          without remembering the scope: `npx mushi-mushi`.
 *
 *          - `npx mushi-mushi`            → runs the wizard
 *          - `npx mushi-mushi init [...]` → runs the wizard with flags
 *          - any other arg                → tells the user to use `@mushi-mushi/cli`
 *            for non-init commands (status, reports, etc.)
 *
 *          Arg parsing, the Node-version guard, and the flags help are shared
 *          with `create-mushi-mushi` via `@mushi-mushi/cli/wizard-args`; only
 *          the bin name, header, and usage lines live here.
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

const BIN = 'mushi-mushi'

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

const HELP = `mushi-mushi — bug-reporting SDK launcher

Usage:
  npx mushi-mushi               run the setup wizard (interactive)
  npx mushi-mushi init          same, with optional flags

Other commands (status, reports, deploy, test, login, config, index) live
in @mushi-mushi/cli — install with \`npm i -g @mushi-mushi/cli\` and use
\`mushi <command>\`.

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
