import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from '../mcp-config.js';

export function registerProjectCommands(program: Command): void {
// ─── project ──────────────────────────────────────────────────────────────────
const project = program.command('project').description('Project management')

project
  .command('create')
  .description('Create a new Mushi project, mint an API key, and write config files')
  .option('--name <name>', 'Project name (skip the prompt)')
  .option('--no-browser', 'Skip opening the browser for the sign-up / magic-link step')
  .option('--endpoint <url>', 'Override API endpoint (self-hosted)')
  .addHelpText('after', `
Creates a project on app.mushimushi.dev, mints an API key with mcp:read+write scope,
and writes the following to the current directory:
  .env.local            — MUSHI_API_KEY, MUSHI_PROJECT_ID, MUSHI_API_ENDPOINT
  .cursor/mcp.json      — pre-filled mcpServers.mushi block for Cursor

Typical first-time flow:
  npx mushi-mushi project create
  # Browser opens → sign up / magic-link → come back to terminal
  # CLI writes .env.local and .cursor/mcp.json
  # mushi whoami to confirm`)
  .action(async (opts: { name?: string; browser?: boolean; endpoint?: string }) => {
    const { writeFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')

    const endpoint = opts.endpoint ?? loadConfig().endpoint ?? 'https://api.mushimushi.dev'
    const signUpUrl = 'https://kensaur.us/mushi-mushi/sign-up'

    console.log('')
    console.log('  Mushi project create')
    console.log('  ─────────────────────')
    console.log('')

    if (opts.browser !== false) {
      console.log('  1. Opening the Mushi sign-up page in your browser...')
      try {
        const { exec } = await import('node:child_process')
        const openCmd = process.platform === 'win32'
          ? `start "" "${signUpUrl}"`
          : process.platform === 'darwin'
            ? `open "${signUpUrl}"`
            : `xdg-open "${signUpUrl}"`
        exec(openCmd)
      } catch { /* ignore */ }
    } else {
      console.log(`  1. Sign up or log in at: ${signUpUrl}`)
    }

    console.log('')
    console.log('  2. Create a project in the console, then paste your credentials below.')
    console.log('     (Settings → API Keys → New key → Copy as .env.local)')
    console.log('')

    // Interactive prompts for credentials
    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q: string): Promise<string> =>
      new Promise(resolve => rl.question(q, (a) => resolve(a.trim())))

    const projectId = await ask('  Project ID (uuid): ')
    const apiKey = await ask('  API key (mushi_...): ')
    rl.close()

    if (!projectId || !apiKey) {
      process.stderr.write('\nerror: Project ID and API key are required.\n')
      process.exit(2)
    }

    // Save to config (~/.config/mushi/config.json, migrated from ~/.mushirc)
    const config = loadConfig()
    config.apiKey = apiKey
    config.endpoint = endpoint
    config.projectId = projectId
    saveConfig(config)

    const cwd = process.cwd()

    // Write .env.local
    const envPath = nodePath.join(cwd, '.env.local')
    const envLines = [
      '# Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.',
      `MUSHI_API_ENDPOINT=${endpoint}`,
      `MUSHI_PROJECT_ID=${projectId}`,
      `MUSHI_API_KEY=${apiKey}`,
      '',
    ]
    const envExisting = existsSync(envPath)
    await writeFile(envPath, envLines.join('\n'), 'utf8')
    console.log(`\n  ✓ ${envExisting ? 'Updated' : 'Created'} .env.local`)

    // Write .cursor/mcp.json (use legacy server name 'mushi' for project use back-compat)
    const mcpPath = nodePath.join(cwd, '.cursor', 'mcp.json')
    const serverName = buildMcpServerName({ legacy: true })
    const serverBlock = buildMcpServerBlock({ endpoint, projectId, apiKey })
    const { created: mcpCreated } = await writeMcpServerEntry({ configPath: mcpPath, serverName, serverBlock })
    console.log(`  ✓ ${mcpCreated ? 'Created' : 'Updated'} .cursor/mcp.json`)

    console.log('')
    console.log('  Done! Restart Cursor and ask: "list mushi tools"')
    console.log('  Run `mushi whoami` to verify the connection.')
    console.log('')
  })

}
