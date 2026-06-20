/**
 * FILE: packages/cli/src/commands/project.ts
 * PURPOSE: `mushi project create` — zero-copy-paste project bootstrap. Signs in
 *          via the browser (RFC 8628 device-auth), creates or selects a project,
 *          mints a report:write SDK key, and writes .env.local + .cursor/mcp.json.
 *
 * OVERVIEW:
 *   - Reuses the shared device-auth primitives so the auth + project + key flow
 *     is identical to `mushi login` and the `mushi init` wizard.
 *   - No UUID / API-key copy-paste: the console approval page hands the CLI a
 *     scoped token, and the key is minted server-side.
 *
 * DEPENDENCIES:
 *   - device-auth.ts (startDeviceAuth / waitForCliToken / listProjects / createProject / mintProjectKey)
 *   - console-url.ts (resolveConsoleUrl, openInBrowser)
 *   - endpoint.ts (resolveCloudEndpoint)
 *   - config.ts (loadConfig / saveConfig)
 *   - mcp-config.ts (buildMcpServerBlock / buildMcpServerName / writeMcpServerEntry)
 *
 * NOTES:
 *   - `--no-browser` prints the verification URL instead of opening it
 *     (headless / SSH). `--name` skips the project-name prompt.
 */

import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from '../mcp-config.js';
import { resolveConsoleUrl, openInBrowser } from '../console-url.js';
import { resolveCloudEndpoint } from '../endpoint.js';
import {
  createProject,
  listProjects,
  mintProjectKey,
  startDeviceAuth,
  waitForCliToken,
  type DeviceProject,
} from '../device-auth.js';

export function registerProjectCommands(program: Command): void {
// ─── project ──────────────────────────────────────────────────────────────────
const project = program.command('project').description('Project management')

project
  .command('create')
  .description('Create or select a Mushi project via browser sign-in, then write config files')
  .option('--name <name>', 'Project name for a new project (skips the prompt)')
  .option('--no-browser', 'Print the verification URL instead of opening the browser')
  .option('--endpoint <url>', 'Override API endpoint (self-hosted)')
  .addHelpText('after', `
Signs you in through the browser (no copy-paste), creates or selects a project,
mints a report:write SDK key, and writes the following to the current directory:
  .env.local            — MUSHI_API_KEY, MUSHI_PROJECT_ID, MUSHI_API_ENDPOINT
  .cursor/mcp.json      — pre-filled mcpServers.mushi block for Cursor

Typical first-time flow:
  npx mushi-mushi project create
  # Browser opens → click Approve → pick or create a project
  # CLI writes .env.local and .cursor/mcp.json
  # mushi whoami to confirm`)
  .action(async (opts: { name?: string; browser?: boolean; endpoint?: string }) => {
    const { writeFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')

    // Honor a previously-saved self-hosted endpoint (`mushi config endpoint …`)
    // so existing users aren't silently redirected to Mushi Cloud. Precedence:
    // --endpoint flag → MUSHI_API_ENDPOINT env → saved config → cloud default.
    const savedConfig = loadConfig()
    const endpoint = resolveCloudEndpoint(opts.endpoint ?? savedConfig.endpoint)
    const consoleBase = await resolveConsoleUrl()

    console.log('')
    console.log('  Mushi project create')
    console.log('  ─────────────────────')
    console.log('')

    // ── Step 1: browser device-auth ──────────────────────────────────────────
    let session: Awaited<ReturnType<typeof startDeviceAuth>>
    try {
      session = await startDeviceAuth(endpoint)
    } catch (err) {
      process.stderr.write(`\nerror: Could not start browser sign-in: ${err instanceof Error ? err.message : String(err)}\n`)
      process.stderr.write('  Fallback: mushi login --api-key <key> --project-id <uuid>\n')
      process.exit(1)
    }

    console.log(`  Confirmation code: ${session.user_code}`)
    console.log('')
    if (opts.browser !== false) {
      console.log('  Opening the Mushi console in your browser…')
      try { await openInBrowser(session.verification_uri) } catch { /* best-effort */ }
    }
    console.log(`  If the browser didn't open: ${session.verification_uri}`)
    console.log('')
    console.log('  Waiting for you to approve in the browser…  (Ctrl+C to cancel)')

    let cliToken: string
    try {
      cliToken = await waitForCliToken(endpoint, session, {
        onPending: () => process.stdout.write('.'),
        onTransientError: () => process.stdout.write('·'),
      })
    } catch (err) {
      console.log('')
      process.stderr.write(`\nerror: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
    console.log('')
    console.log('  ✓ Approved!')

    // ── Step 2: pick or create a project ─────────────────────────────────────
    const projectsList = await listProjects(endpoint, cliToken)

    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))

    let chosen: DeviceProject | undefined
    let projectId: string | undefined
    let projectName: string | undefined
    let apiKey: string | undefined

    if (!opts.name && projectsList.length > 0) {
      console.log('')
      console.log('  Your projects:')
      projectsList.forEach((pr, i) => {
        console.log(`    ${i + 1}. ${pr.name} (${pr.id})`)
      })
      console.log(`    ${projectsList.length + 1}. Create a new project`)
      console.log('')
      const choice = await ask(`  Pick a project [1-${projectsList.length + 1}]: `)
      const num = parseInt(choice, 10)
      if (num >= 1 && num <= projectsList.length) {
        chosen = projectsList[num - 1]
        projectId = chosen.id
        projectName = chosen.name
      }
    }

    if (!projectId) {
      const newName = opts.name?.trim() || (await ask('  Project name: '))
      if (!newName) {
        rl.close()
        process.stderr.write('\nerror: Project name is required.\n')
        process.exit(2)
      }
      try {
        const created = await createProject(endpoint, cliToken, newName)
        projectId = created.id
        projectName = created.name
        apiKey = created.apiKey ?? undefined
        console.log(`  ✓ Created project "${projectName}"`)
      } catch (err) {
        rl.close()
        process.stderr.write(`\nerror: Could not create project: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }
    }
    rl.close()

    // ── Step 3: mint a report:write key if we selected an existing project ────
    if (projectId && !apiKey) {
      apiKey = (await mintProjectKey(endpoint, cliToken, projectId)) ?? undefined
    }

    if (!projectId || !apiKey) {
      process.stderr.write('\nerror: Could not obtain an SDK key for the project. Run `mushi login` and try again.\n')
      process.exit(1)
    }

    // ── Step 4: persist config + write project files ─────────────────────────
    const config = loadConfig()
    config.apiKey = apiKey
    config.endpoint = endpoint
    config.projectId = projectId
    config.consoleUrl = consoleBase
    saveConfig(config)

    const cwd = process.cwd()

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
