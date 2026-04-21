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
 */

import { runInit } from '@mushi-mushi/cli/init'
import { FRAMEWORK_IDS, isFrameworkId, type FrameworkId } from '@mushi-mushi/cli/detect'

declare const __MUSHI_LAUNCHER_VERSION__: string | undefined

const VERSION: string =
  typeof __MUSHI_LAUNCHER_VERSION__ === 'string' ? __MUSHI_LAUNCHER_VERSION__ : '0.0.0-dev'

const MIN_NODE_MAJOR = 18

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

const HELP = `mushi-mushi — bug-reporting SDK launcher

Usage:
  npx mushi-mushi               run the setup wizard (interactive)
  npx mushi-mushi init          same, with optional flags

Flags (forwarded to \`mushi init\`):
  --project-id <id>             skip the project ID prompt
  --api-key <key>               skip the API key prompt (CI only — leaks into \`ps\`)
  --framework <id>              force a framework (${FRAMEWORK_IDS.join(', ')})
  --skip-install                print the install command instead of running it
  --skip-test-report            don't offer to send a test report at the end
  --cwd <path>                  run in a different directory
  --endpoint <url>              override the Mushi API endpoint (self-hosted)
  -y, --yes                     accept the detected framework without prompting
  -v, --version                 print the launcher version and exit
  -h, --help                    show this help

Other commands (status, reports, deploy, test, login, config, index) live
in @mushi-mushi/cli — install with \`npm i -g @mushi-mushi/cli\` and use
\`mushi <command>\`.

Docs:    https://github.com/kensaurus/mushi-mushi
Console: https://kensaur.us/mushi-mushi/`

interface ParsedArgs {
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
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args = argv[0] === 'init' ? argv.slice(1) : argv
  const out: ParsedArgs = { showHelp: false, showVersion: false }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-h' || a === '--help') { out.showHelp = true; continue }
    if (a === '-v' || a === '--version') { out.showVersion = true; continue }
    if (a === '-y' || a === '--yes') { out.yes = true; continue }
    if (a === '--skip-install') { out.skipInstall = true; continue }
    if (a === '--skip-test-report') { out.skipTestReport = true; continue }
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

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split('.')[0])
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `mushi-mushi requires Node.js ${MIN_NODE_MAJOR} or newer. You are on ${process.versions.node}.\n` +
        'Upgrade Node (https://nodejs.org/) and try again.\n',
    )
    process.exit(1)
  }
}

async function main(): Promise<void> {
  assertNodeVersion()

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
  process.stderr.write(`\nmushi-mushi: ${message}\n`)
  if (process.env.DEBUG?.includes('mushi') && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n')
  }
  process.stderr.write(`\nIf this is a bug, please report it at ${ISSUES_URL}\n`)
  process.exit(1)
})
