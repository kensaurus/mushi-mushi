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

import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
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

const BIN = 'create-mushi-mushi'

const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'

/** Starter templates shipped inside the published package (templates/<id>/). */
const TEMPLATE_IDS = ['vue', 'svelte', 'node'] as const
type TemplateId = (typeof TEMPLATE_IDS)[number]

const HELP = `create-mushi-mushi — add Mushi Mushi to your existing project

By default this does NOT scaffold a new app. It runs the setup wizard in your
current project: detects your framework and installs the right Mushi package.
With --template it scaffolds a minimal starter app instead.

Usage:
  npm create mushi-mushi                          run the wizard (existing project)
  npm create mushi-mushi -- --template vue        scaffold a starter (vue | svelte | node)
  npm create mushi-mushi -- --template vue my-app scaffold into ./my-app
  npm create mushi-mushi -- --help                show all flags

Note: \`npm create\` requires the \`--\` separator before flags.
      \`yarn create mushi-mushi --help\` works without it on Yarn 1.
      \`pnpm create mushi-mushi -- --help\` mirrors npm.
      \`bun create mushi-mushi --help\` works without it.

${FLAGS_HELP}`

/**
 * Scaffold `templates/<id>` into targetDir and print next steps. Kept
 * dependency-free (plain cpSync) — the starter's own README covers install
 * and `npx mushi-mushi` for credentials, so no wizard run happens here.
 */
function scaffoldTemplate(id: TemplateId, targetArg: string | undefined): void {
  const targetDir = resolve(process.cwd(), targetArg ?? `mushi-${id}-app`)
  if (existsSync(targetDir)) {
    process.stderr.write(`${BIN}: target directory already exists: ${targetDir}\n`)
    process.exit(1)
  }
  const templateDir = fileURLToPath(new URL(`../templates/${id}`, import.meta.url))
  cpSync(templateDir, targetDir, { recursive: true })
  process.stdout.write(
    `Scaffolded the ${id} starter into ${targetDir}\n\n` +
      'Next steps:\n' +
      `  cd "${targetArg ?? `mushi-${id}-app`}"\n` +
      '  npm install\n' +
      '  npx mushi-mushi     # browser sign-in, writes your env vars\n' +
      `  ${id === 'node' ? 'npm start' : 'npm run dev'}\n`,
  )
}

/**
 * Pull `--template <id> [dir]` out of argv before the shared wizard parser
 * sees it (parseArgs rejects unknown flags — --template is create-only; the
 * `mushi-mushi` launcher never scaffolds).
 */
function extractTemplateArgs(argv: readonly string[]): {
  template?: TemplateId
  targetDir?: string
  rest: string[]
} {
  const rest: string[] = []
  let template: TemplateId | undefined
  let targetDir: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--template') {
      const id = argv[++i]
      if (!TEMPLATE_IDS.includes(id as TemplateId)) {
        process.stderr.write(
          `${BIN}: unknown template: ${id ?? '(missing)'}. Valid: ${TEMPLATE_IDS.join(', ')}\n`,
        )
        process.exit(1)
      }
      template = id as TemplateId
      // Optional positional target dir directly after the template id.
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) targetDir = argv[++i]
      continue
    }
    rest.push(argv[i])
  }
  return { template, targetDir, rest }
}

async function main(): Promise<void> {
  assertNodeVersion(BIN)

  const { template, targetDir, rest } = extractTemplateArgs(process.argv.slice(2))
  if (template) {
    scaffoldTemplate(template, targetDir)
    return
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(rest)
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
    audit: parsed.audit,
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
