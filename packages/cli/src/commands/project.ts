/**
 * FILE: packages/cli/src/commands/project.ts
 * PURPOSE: `mushi project create` — device-auth sign-in, project bootstrap, SDK key mint, and env/MCP writes.
 */

import type { Command } from 'commander';
import { ensureClientId, loadConfig, saveConfig } from '../config.js';
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
import { printAuthBanner, printAuthApproved, printAuthFailed } from '../auth-ui.js';
import { writeProjectBootstrapFiles } from '../project-bootstrap.js';

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
    // Honor a previously-saved self-hosted endpoint (`mushi config endpoint …`)
    // so existing users aren't silently redirected to Mushi Cloud. Precedence:
    // --endpoint flag → MUSHI_API_ENDPOINT env → saved config → cloud default.
    const savedConfig = loadConfig()
    const endpoint = resolveCloudEndpoint(
      opts.endpoint ?? process.env.MUSHI_API_ENDPOINT?.trim() ?? savedConfig.endpoint,
    )
    const consoleBase = await resolveConsoleUrl()

    console.log('')
    console.log('  Mushi project create')
    console.log('  ─────────────────────')
    console.log('')

    // ── Step 1: browser device-auth ──────────────────────────────────────────
    let session: Awaited<ReturnType<typeof startDeviceAuth>>
    try {
      session = await startDeviceAuth(endpoint, ensureClientId())
    } catch (err) {
      process.stderr.write(`\nerror: Could not start browser sign-in: ${err instanceof Error ? err.message : String(err)}\n`)
      process.stderr.write('  Fallback: mushi login --api-key <key> --project-id <uuid>\n')
      process.exit(1)
    }

    if (opts.browser !== false) {
      try { await openInBrowser(session.verification_uri) } catch { /* best-effort — URL shown in banner */ }
    }
    printAuthBanner(session.user_code, session.verification_uri)

    let cliToken: string
    try {
      cliToken = await waitForCliToken(endpoint, session)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('denied')) printAuthFailed('denied')
      else if (msg.includes('timed out') || msg.includes('expired')) printAuthFailed('timeout')
      else printAuthFailed('error', msg)
      process.exit(1)
    }
    printAuthApproved()

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

    const { envUpdated, mcpUpdated } = await writeProjectBootstrapFiles({
      endpoint,
      projectId,
      apiKey,
    })
    console.log(`\n  OK  ${envUpdated ? 'Updated' : 'Created'} .env.local`)
    console.log(`  OK  ${mcpUpdated ? 'Updated' : 'Created'} .cursor/mcp.json`)

    console.log('')
    console.log('  Done! Restart Cursor and ask: "list mushi tools"')
    console.log('  Run `mushi whoami` to verify the connection.')
    console.log('')
  })

}
