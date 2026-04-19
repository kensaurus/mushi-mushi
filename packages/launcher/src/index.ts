/**
 * FILE: packages/launcher/src/index.ts
 * PURPOSE: Unscoped `mushi-mushi` bin — thin shim that delegates to
 *          `@mushi-mushi/cli`'s `init` command. Lets users run the wizard
 *          without remembering the scope: `npx mushi-mushi`.
 *
 *          - `npx mushi-mushi`            → runs the wizard
 *          - `npx mushi-mushi init [...]` → runs the wizard with flags
 *          - any other arg               → tells the user to use `@mushi-mushi/cli`
 *            for non-init commands (status, reports, etc.)
 */

import { runInit } from '@mushi-mushi/cli/init'
import type { FrameworkId } from '@mushi-mushi/cli/detect'

const HELP = `mushi-mushi — bug-reporting SDK launcher

Usage:
  npx mushi-mushi               run the setup wizard (interactive)
  npx mushi-mushi init          same, with optional flags

Flags (forwarded to \`mushi init\`):
  --project-id <id>             skip the project ID prompt
  --api-key <key>               skip the API key prompt
  --framework <id>              force a framework (next, react, vue, nuxt,
                                svelte, sveltekit, angular, expo,
                                react-native, capacitor, vanilla)
  --skip-install                print the install command instead of running it
  -y, --yes                     accept the detected framework without prompting
  -h, --help                    show this help

Other commands (status, reports, deploy, test, login, config, index) live
in @mushi-mushi/cli — install with \`npm i -g @mushi-mushi/cli\` and use
\`mushi <command>\`.

Docs:    https://github.com/kensaurus/mushi-mushi
Console: https://kensaur.us/mushi-mushi/`

const VALID_FRAMEWORKS: ReadonlyArray<FrameworkId> = [
  'next', 'react', 'vue', 'nuxt', 'svelte', 'sveltekit',
  'angular', 'expo', 'react-native', 'capacitor', 'vanilla',
]

function parseArgs(argv: readonly string[]): {
  showHelp: boolean
  projectId?: string
  apiKey?: string
  framework?: FrameworkId
  skipInstall?: boolean
  yes?: boolean
} {
  const args = argv[0] === 'init' ? argv.slice(1) : argv
  const out: ReturnType<typeof parseArgs> = { showHelp: false }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-h' || a === '--help') { out.showHelp = true; continue }
    if (a === '-y' || a === '--yes') { out.yes = true; continue }
    if (a === '--skip-install') { out.skipInstall = true; continue }
    if (a === '--project-id') { out.projectId = args[++i]; continue }
    if (a === '--api-key') { out.apiKey = args[++i]; continue }
    if (a === '--framework') {
      const fw = args[++i]
      if (!VALID_FRAMEWORKS.includes(fw as FrameworkId)) {
        throw new Error(`Unknown framework: ${fw}. Valid: ${VALID_FRAMEWORKS.join(', ')}`)
      }
      out.framework = fw as FrameworkId
      continue
    }
    if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}. Try --help.`)
    }
  }
  return out
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  if (parsed.showHelp) {
    console.log(HELP)
    return
  }

  await runInit({
    projectId: parsed.projectId,
    apiKey: parsed.apiKey,
    framework: parsed.framework,
    skipInstall: parsed.skipInstall,
    yes: parsed.yes,
  })
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
