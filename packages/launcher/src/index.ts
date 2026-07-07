// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/launcher/src/index.ts
 * PURPOSE: Unscoped `mushi-mushi` bin — thin shim that delegates to
 *          `@mushi-mushi/cli`. Lets users run any CLI command without
 *          remembering the scope: `npx mushi-mushi`.
 *
 *          - `npx mushi-mushi`               → runs the wizard
 *          - `npx mushi-mushi init [...]`    → runs the wizard with flags
 *          - `npx mushi-mushi <cmd> [...]`   → forwarded verbatim to
 *            `@mushi-mushi/cli`'s `mushi` bin (setup, login, status, etc.)
 *
 *          Arg parsing, the Node-version guard, and the flags help are shared
 *          with `create-mushi-mushi` via `@mushi-mushi/cli/wizard-args`; only
 *          the bin name, header, usage lines, and CLI forwarding live here.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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

Other commands (setup, status, reports, deploy, test, login, config, ...)
are forwarded to @mushi-mushi/cli, e.g. \`npx mushi-mushi setup --ide cursor\`.

${FLAGS_HELP}

Docs:    https://github.com/kensaurus/mushi-mushi
Console: https://kensaur.us/mushi-mushi/`

/**
 * Any first arg that isn't `init` and isn't a flag is a `@mushi-mushi/cli`
 * subcommand (setup, login, status, ...) — forward it verbatim instead of
 * silently dropping it (bare `mushi-mushi setup` used to fall through to
 * the init wizard) or throwing on its trailing flags (`--ide` etc.).
 */
function forwardToCli(argv: readonly string[]): never {
  const cliBin = fileURLToPath(import.meta.resolve('@mushi-mushi/cli'))
  const result = spawnSync(process.execPath, [cliBin, ...argv], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

async function main(): Promise<void> {
  assertNodeVersion(BIN)

  const rawArgs = process.argv.slice(2)
  const first = rawArgs[0]
  if (first !== undefined && first !== 'init' && !first.startsWith('-')) {
    forwardToCli(rawArgs)
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(rawArgs)
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
