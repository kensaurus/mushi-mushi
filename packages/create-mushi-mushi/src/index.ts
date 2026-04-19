/**
 * FILE: packages/create-mushi-mushi/src/index.ts
 * PURPOSE: `npm create mushi-mushi` shim — npm passes whatever args follow,
 *          we forward them to the same wizard `mushi-mushi` runs. Lets users
 *          discover us via the standard `npm create <name>` workflow.
 */

import { runInit } from '@mushi-mushi/cli/init'
import type { FrameworkId } from '@mushi-mushi/cli/detect'

const HELP = `create-mushi-mushi — add Mushi Mushi to your existing project

Usage:
  npm create mushi-mushi              run the setup wizard
  npm create mushi-mushi -- --help    show all flags

Flags (forwarded to the wizard):
  --project-id <id>            skip the project ID prompt
  --api-key <key>              skip the API key prompt
  --framework <id>             force a framework (next, react, vue, nuxt,
                               svelte, sveltekit, angular, expo,
                               react-native, capacitor, vanilla)
  --skip-install               print the install command instead of running it
  -y, --yes                    accept the detected framework without prompting

Docs:    https://github.com/kensaurus/mushi-mushi
Console: https://kensaur.us/mushi-mushi/`

const VALID_FRAMEWORKS: ReadonlyArray<FrameworkId> = [
  'next', 'react', 'vue', 'nuxt', 'svelte', 'sveltekit',
  'angular', 'expo', 'react-native', 'capacitor', 'vanilla',
]

function parseArgs(args: readonly string[]): {
  showHelp: boolean
  projectId?: string
  apiKey?: string
  framework?: FrameworkId
  skipInstall?: boolean
  yes?: boolean
} {
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
