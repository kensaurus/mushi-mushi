import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { requireConfig } from '../cli-shared.js'
import { loadConfig } from '../config.js'

/** `mushi ux …` runs the `mushi-ux` bin of @mushi-mushi/ux (kept out of this CLI: it ships Playwright). MUSHI_UX_BIN = local build. */
const UX_PACKAGE = '@mushi-mushi/ux@^0.3.0'

interface UxSpawn {
  cmd: string
  argv: string[]
  shell: boolean
}

function cmdQuote(arg: string): string {
  return /^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`
}

/**
 * Where npm's npx-cli.js sits next to the running Node: beside node.exe on
 * Windows, under <prefix>/lib/node_modules on Linux and macOS (CI found only
 * the Windows layout and fell back to a bare `npx`, 2026-10-07).
 */
const NPX_CLI_CANDIDATES: readonly string[] = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
]

/** How to start `mushi-ux`; the local worker (worker/fresh-eyes.ts) runs first-time user tests through it too. */
export function uxCommandLine(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  npxCli: string | readonly string[] = NPX_CLI_CANDIDATES,
  hasFile: (p: string) => boolean = existsSync,
): UxSpawn {
  const local = env.MUSHI_UX_BIN?.trim()
  if (local) return { cmd: process.execPath, argv: [local, ...args], shell: false }
  const npxArgs = ['--yes', '--package', UX_PACKAGE, 'mushi-ux', ...args]
  const found = (typeof npxCli === 'string' ? [npxCli] : npxCli).find((p) => hasFile(p))
  if (found) return { cmd: process.execPath, argv: [found, ...npxArgs], shell: false }
  if (platform === 'win32') return { cmd: 'npx', argv: npxArgs.map(cmdQuote), shell: true }
  return { cmd: 'npx', argv: npxArgs, shell: false }
}

export function registerUxCommands(program: Command): void {
  program
    .command('ux')
    .description('Run your coding agent over every screen of your app and keep only measured UX improvements (local, uses @mushi-mushi/ux)')
    .argument('[args...]', 'Passed to mushi-ux: ui | run | discover | audit | explore | fresh-eyes | login | models | skills | open')
    .allowUnknownOption()
    .helpOption(false)
    .addHelpText(
      'after',
      `
Examples:
  mushi ux ui                                   # studio: pick agent, model, skill; watch every attempt
  mushi ux models --agent cursor                # models your Cursor account can use
  mushi ux discover --url http://localhost:5173
  mushi ux run --dev "pnpm dev --port {port}" --agent claude-code
  mushi ux run --dev "pnpm dev --port {port}" --agent cursor --model <id from \`agent --list-models\`>
  mushi ux fresh-eyes --url https://your-app.com --goal "get my first report" --dry-run
                                                # a first-time visitor: time the path, file what stops them
  mushi ux --help`,
    )
    .action((args: string[]) => {
      const { cmd, argv, shell } = uxCommandLine(args)
      // The CLI login rides in the child's env; mushi-ux strips MUSHI_* before any agent runs.
      // --sync needs it; the studio (ui) uses it when present and offers sync then.
      let env = process.env
      // --sync and --mint-account need the login; --file and the studio use it when there is one.
      if (args.includes('--sync') || args.includes('--mint-account')) {
        const config = requireConfig({ needsProject: true })
        env = { ...process.env, MUSHI_API_KEY: config.apiKey, MUSHI_PROJECT_ID: config.projectId, MUSHI_API_ENDPOINT: config.endpoint }
      } else if (args[0] === 'ui' || args.includes('--file')) {
        const config = loadConfig()
        if (config.apiKey && config.projectId) {
          env = { ...process.env, MUSHI_API_KEY: config.apiKey, MUSHI_PROJECT_ID: config.projectId, ...(config.endpoint ? { MUSHI_API_ENDPOINT: config.endpoint } : {}) }
        }
      }
      const child = spawn(cmd, argv, { stdio: 'inherit', shell, env })
      child.on('error', (err) => {
        process.stderr.write(`error: could not start mushi-ux (${err.message}). Install it with: npm i -g @mushi-mushi/ux\n`)
        process.exit(1)
      })
      child.on('exit', (code) => process.exit(code ?? 1))
    })
}
