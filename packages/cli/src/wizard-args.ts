// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/cli/src/wizard-args.ts
 * PURPOSE: Shared argument parsing, Node-version guard, and help text for the
 *          two thin entry-point shims (`mushi-mushi` launcher and
 *          `create-mushi-mushi`). Both bins forward the same flags to
 *          `runInit`, so the parsing and the flags help live here once. Each
 *          shim keeps only its own bin name, header, and usage lines.
 */

import { FRAMEWORK_IDS, isFrameworkId, type FrameworkId } from './detect'

/** Minimum Node major both shims require. Kept in sync with each package's `engines.node`. */
export const MIN_NODE_MAJOR = 20

export interface ParsedArgs {
  showHelp: boolean
  showVersion: boolean
  projectId?: string
  apiKey?: string
  framework?: FrameworkId
  skipInstall?: boolean
  skipTestReport?: boolean
  yes?: boolean
  cwd?: string
  endpoint?: string
  audit?: boolean
}

/**
 * The flags block shared by both shims' help text. Ends with the Node
 * requirement line and the docs footer. Each shim prepends its own
 * bin-specific header and usage section.
 */
export const FLAGS_HELP = `Flags (forwarded to the wizard):
  --project-id <uuid>           skip the project ID prompt (UUID from the Projects page)
  --api-key <key>               skip the API key prompt (CI only — leaks into \`ps\`)
  --framework <id>              force a framework (${FRAMEWORK_IDS.join(', ')})
  --skip-install                print the install command instead of running it
  --skip-test-report            don't offer to send a test report at the end
  --audit                       health-check an existing install (doctor checks) instead of re-running the wizard
  --cwd <path>                  run in a different directory
  --endpoint <url>              override the Mushi API endpoint (self-hosted)
  -y, --yes                     accept the detected framework without prompting
  -v, --version                 print the version and exit
  -h, --help                    show this help

Requires Node.js ${MIN_NODE_MAJOR} or newer.

Docs:    https://github.com/kensaurus/mushi-mushi
Console: https://kensaur.us/mushi-mushi/`

/**
 * Parse the wizard flags. A leading `init` token is tolerated (so
 * `npx mushi-mushi init --yes` works the same as `npx mushi-mushi --yes`).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = argv[0] === 'init' ? argv.slice(1) : argv
  const out: ParsedArgs = { showHelp: false, showVersion: false }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-h' || a === '--help') { out.showHelp = true; continue }
    if (a === '-v' || a === '--version') { out.showVersion = true; continue }
    if (a === '-y' || a === '--yes') { out.yes = true; continue }
    if (a === '--skip-install') { out.skipInstall = true; continue }
    if (a === '--skip-test-report') { out.skipTestReport = true; continue }
    if (a === '--audit') { out.audit = true; continue }
    if (a === '--project-id') { out.projectId = args[++i]; continue }
    if (a === '--api-key') { out.apiKey = args[++i]; continue }
    if (a === '--cwd') { out.cwd = args[++i]; continue }
    if (a === '--endpoint') { out.endpoint = args[++i]; continue }
    if (a === '--framework') {
      const fw = args[++i]
      if (!isFrameworkId(fw)) {
        throw new Error(`Unknown framework: ${fw}. Valid: ${FRAMEWORK_IDS.join(', ')}`)
      }
      out.framework = fw
      continue
    }
    if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}. Try --help.`)
    }
  }
  return out
}

/**
 * Exit with a friendly message if the running Node is older than
 * {@link MIN_NODE_MAJOR}. `binName` is the invoking command (e.g. `mushi-mushi`
 * or `create-mushi-mushi`) so the error reads naturally.
 */
export function assertNodeVersion(binName: string): void {
  const major = Number(process.versions.node.split('.')[0])
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `${binName} requires Node.js ${MIN_NODE_MAJOR} or newer. You are on ${process.versions.node}.\n` +
        'Upgrade Node (https://nodejs.org/) and try again.\n',
    )
    process.exit(1)
  }
}
