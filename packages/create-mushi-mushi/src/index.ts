/**
 * FILE: packages/create-mushi-mushi/src/index.ts
 * PURPOSE: `npm create mushi-mushi` shim — npm passes whatever args follow,
 *          we forward them to the same wizard `mushi-mushi` runs. Lets users
 *          discover us via the standard `npm create <name>` workflow.
 */

import { runInit } from '@mushi-mushi/cli/init'
import { FRAMEWORK_IDS, isFrameworkId, type FrameworkId } from '@mushi-mushi/cli/detect'

declare const __MUSHI_LAUNCHER_VERSION__: string | undefined

const VERSION: string =
  typeof __MUSHI_LAUNCHER_VERSION__ === 'string' ? __MUSHI_LAUNCHER_VERSION__ : '0.0.0-dev'

const MIN_NODE_MAJOR = 18

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

const HELP = `create-mushi-mushi — add Mushi Mushi to your existing project

Usage:
  npm create mushi-mushi              run the setup wizard
  npm create mushi-mushi -- --help    show all flags

Note: \`npm create\` requires the \`--\` separator before flags.
      \`yarn create mushi-mushi --help\` works without it on Yarn 1.
      \`pnpm create mushi-mushi -- --help\` mirrors npm.
      \`bun create mushi-mushi --help\` works without it.

Flags (forwarded to the wizard):
  --project-id <id>            skip the project ID prompt
  --api-key <key>              skip the API key prompt (CI only)
  --framework <id>             force a framework (${FRAMEWORK_IDS.join(', ')})
  --skip-install               print the install command instead of running it
  --skip-test-report           don't offer to send a test report at the end
  --cwd <path>                 run in a different directory
  --endpoint <url>             override the Mushi API endpoint (self-hosted)
  -y, --yes                    accept the detected framework without prompting
  -v, --version                print the version and exit

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

function parseArgs(args: readonly string[]): ParsedArgs {
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
      `create-mushi-mushi requires Node.js ${MIN_NODE_MAJOR} or newer. You are on ${process.versions.node}.\n` +
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
  process.stderr.write(`\ncreate-mushi-mushi: ${message}\n`)
  if (process.env.DEBUG?.includes('mushi') && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n')
  }
  process.stderr.write(`\nIf this is a bug, please report it at ${ISSUES_URL}\n`)
  process.exit(1)
})
