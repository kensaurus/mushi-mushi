// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/cli/src/wizard-bin.ts
 * PURPOSE: Everything the two unscoped bins do, in one place. `npx mushi-mushi`
 *          (packages/launcher) and `npm create mushi-mushi`
 *          (packages/create-mushi-mushi) both call runWizardBin and keep only
 *          their bin name, version and usage lines (ADR 0060 Phase 1b):
 *
 *          - no args / flags     → the setup wizard (runInit)
 *          - `init [flags]`      → same
 *          - `--template <id>`   → scaffold a starter app (template.ts)
 *          - `<cmd> [...]`       → forwarded verbatim to the `mushi` bin
 *            (setup, login, status, ...)
 *          - `<word> [...]`      → a bare word that is not a command
 *            (`npm create mushi-mushi my-app`) runs the wizard after one
 *            hint line about `--template`
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInit } from './init'
import { scaffoldTemplate } from './template'
import {
  assertNodeVersion,
  FLAGS_HELP,
  newAppHint,
  parseArgs,
  UNKNOWN_COMMAND_EXIT,
  WIZARD_PROBE_ENV,
  type ParsedArgs,
} from './wizard-args'

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

export interface WizardBinOptions {
  /** The command the user typed, for messages (`mushi-mushi`, `create-mushi-mushi`). */
  bin: string
  /** Printed by `--version`: the invoking package's own version. */
  version: string
  /**
   * The bin's header and usage lines. FLAGS_HELP (with the --template line,
   * the Node requirement and the Docs/Console footer) is appended, so the
   * usage block must not repeat that footer.
   */
  usage: string
}

/**
 * Any first arg that isn't `init` and isn't a flag is tried as a `mushi`
 * subcommand (setup, login, status, ...): forward it verbatim instead of
 * silently dropping it or throwing on its trailing flags (`--ide` etc.).
 *
 * The CLI is started with WIZARD_PROBE_ENV so a word that is not one of its
 * commands exits UNKNOWN_COMMAND_EXIT before printing anything. That returns
 * false here and the caller runs the wizard, as `npm create mushi-mushi
 * my-app` did before. A real command never returns: this exits with its status.
 */
function forwardToCli(bin: string, argv: readonly string[]): boolean {
  // dist/wizard-bin.js sits next to dist/index.js, the `mushi` bin.
  const cliBin = fileURLToPath(new URL('./index.js', import.meta.url))
  const result = spawnSync(process.execPath, [cliBin, ...argv], {
    stdio: 'inherit',
    env: { ...process.env, [WIZARD_PROBE_ENV]: '1' },
  })
  if (result.status === UNKNOWN_COMMAND_EXIT) return false
  // A spawn failure (ENOENT, missing dist) or a kill leaves status null; say
  // why instead of exiting 1 silently.
  if (result.error) {
    process.stderr.write(`${bin}: could not start @mushi-mushi/cli (${result.error.message})\n`)
  } else if (result.signal) {
    process.stderr.write(`${bin}: @mushi-mushi/cli was stopped by ${result.signal}\n`)
  }
  process.exit(result.status ?? 1)
}

async function main(argv: readonly string[], opts: WizardBinOptions): Promise<void> {
  assertNodeVersion(opts.bin)

  // A bare word that is not a `mushi` command: run the wizard below, after
  // one hint line, unless the user already asked for a starter.
  let bareWord: string | undefined
  const first = argv[0]
  if (first !== undefined && first !== 'init' && !first.startsWith('-')) {
    if (!forwardToCli(opts.bin, argv)) bareWord = first
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${opts.bin}: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  if (bareWord !== undefined && !parsed.template && !parsed.showHelp && !parsed.showVersion) {
    process.stderr.write(newAppHint(bareWord) + '\n')
  }

  if (parsed.showHelp) {
    process.stdout.write(`${opts.usage}\n\n${FLAGS_HELP}\n`)
    return
  }

  if (parsed.showVersion) {
    process.stdout.write(opts.version + '\n')
    return
  }

  if (parsed.template) {
    try {
      process.stdout.write(scaffoldTemplate(parsed.template, parsed.templateDir))
    } catch (err) {
      process.stderr.write(`${opts.bin}: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
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
    audit: parsed.audit,
  })
}

/** Run a bin's argv (`process.argv.slice(2)`), printing failures and exiting 1. */
export function runWizardBin(argv: readonly string[], opts: WizardBinOptions): Promise<void> {
  return main(argv, opts).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`\n${opts.bin}: ${message}\n`)
    if (process.env.DEBUG?.includes('mushi') && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n')
    }
    process.stderr.write(`\nIf this is a bug, please report it at ${ISSUES_URL}\n`)
    process.exit(1)
  })
}
