// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/cli/src/wizard-args.ts
 * PURPOSE: Shared argument parsing, Node-version guard, and help text for the
 *          two thin entry-point shims (`mushi-mushi` launcher and
 *          `create-mushi-mushi`). Both bins forward the same flags to
 *          `runInit`, so the parsing and the flags help live here once. Each
 *          shim keeps only its own bin name, header, and usage lines.
 */

import { FRAMEWORK_IDS, isFrameworkId, type FrameworkId } from './detect'
import { TEMPLATE_IDS, isTemplateId, type TemplateId } from './template'

/** Minimum Node major both shims require. Kept in sync with each package's `engines.node`. */
export const MIN_NODE_MAJOR = 20

/**
 * `npm create mushi-mushi my-app` passes a bare word that is not a `mushi`
 * command. The bins forward every bare word to the `mushi` bin with this env
 * var set; the CLI checks the word against its live command tree and, if it
 * is unknown, exits {@link UNKNOWN_COMMAND_EXIT} without printing anything, so
 * the bin runs the wizard instead. No hand-kept command list to drift.
 */
export const WIZARD_PROBE_ENV = 'MUSHI_WIZARD_PROBE'
/** EX_USAGE. The CLI's own exit codes are 0–3, so this cannot be mistaken for one. */
export const UNKNOWN_COMMAND_EXIT = 64

/** The command(s) a top-level `mushi` invocation would not recognise. */
export function isUnknownTopLevelCommand(
  word: string | undefined,
  commands: ReadonlyArray<{ name(): string; aliases(): string[] }>,
): boolean {
  if (word === undefined || word.startsWith('-') || word === 'help') return false
  return !commands.some((c) => c.name() === word || c.aliases().includes(word))
}

/** The one line printed before the wizard when the bare word was not a command. */
export function newAppHint(word: string): string {
  return `To start a new app instead: npx mushi-mushi --template <${TEMPLATE_IDS.join('|')}> ${word}`
}

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
  /** `--template <id>`: scaffold a starter app instead of running the wizard. */
  template?: TemplateId
  /** Optional directory right after the template id. */
  templateDir?: string
}

/**
 * The flags block shared by both shims' help text. Ends with the Node
 * requirement line and the docs footer — the shims must not repeat that
 * footer. Each shim prepends its own bin-specific header and usage section.
 */
export const FLAGS_HELP = `Start a new app instead:
  --template <id> [dir]         scaffold a starter app (${TEMPLATE_IDS.join(', ')}) into [dir]
                                (default ./mushi-<id>-app) instead of running the wizard

Flags (forwarded to the wizard):
  --project-id <uuid>           skip the project ID prompt (UUID from the Projects page)
  --api-key <key>               skip the API key prompt with an ingest-only key (CI only — leaks into \`ps\`)
  --framework <id>              force a framework (${FRAMEWORK_IDS.join(', ')})
  --skip-install                print the install command instead of running it
  --skip-test-report            don't offer to send a test report at the end
  --audit                       health-check an existing install (doctor checks) instead of re-running the wizard
  --cwd <path>                  run in a different directory
  --endpoint <url>              override the Mushi API endpoint (self-hosted)
  -y, --yes                     take the defaults: detected framework, saved credentials, browser sign-in
                                (required in non-interactive shells such as an AI agent's terminal, where
                                the sign-in URL is printed and the project is picked by the app's name)
  -v, --version                 print the version and exit
  -h, --help                    show this help

Requires Node.js ${MIN_NODE_MAJOR} or newer.

Docs:    https://kensaur.us/mushi-mushi/docs/
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
    if (a === '--template') {
      const id = args[++i]
      if (!isTemplateId(id)) {
        throw new Error(`Unknown template: ${id ?? '(missing)'}. Valid: ${TEMPLATE_IDS.join(', ')}`)
      }
      out.template = id
      // Optional target directory directly after the template id.
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) out.templateDir = args[++i]
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
