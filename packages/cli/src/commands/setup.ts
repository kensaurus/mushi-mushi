import type { Command } from 'commander';
import { requireConfig } from '../cli-shared.js';
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from '../mcp-config.js';

export function registerSetupCommands(program: Command): void {
// ─── setup ────────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Wire Cursor MCP into your IDE (reads ~/.config/mushi/config.json — run `mushi login` first)')
  .option('--ide <ide>', 'Target IDE: cursor | claude | continue | zed', 'cursor')
  .option('--project-slug <slug>', 'Override the project slug in the server name (default: fetched from API or ID prefix)')
  .option('--all-projects', 'Write a separate mushi-<name> server entry for every accessible project')
  .option('--with-rules', 'Also write the .cursorrules / .claude/rules/mushi.md lesson-library hook')
  .option('--dry-run', 'Print what would be written without making changes')
  .option('--verify', 'Probe the MCP key after writing to confirm it has mcp:read scope (default: on)')
  .option('--no-verify', 'Skip the post-write key probe')
  .addHelpText('after', `
Examples:
  mushi setup                         # wire Cursor (default)
  mushi setup --all-projects          # one server entry per accessible project
  mushi setup --ide claude            # wire Claude Code
  mushi setup --ide cursor --with-rules  # also write .cursorrules

Supported IDEs:
  cursor    — writes .cursor/mcp.json
  claude    — writes .claude/mcp.json (Claude Code / Claude Desktop)
  continue  — writes .continue/mcp.json
  zed       — writes ~/.config/zed/settings.json mcpServers block

The command reads credentials from ~/.config/mushi/config.json (run \`mushi login\` first).`)
  .action(async (opts: { ide: string; projectSlug?: string; allProjects?: boolean; withRules?: boolean; dryRun?: boolean; verify?: boolean }) => {
    const { writeFile, mkdir, readFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const os = await import('node:os')

    const config = requireConfig({ needsProject: true })

    // Mask the API key when echoing config to the terminal (dry-run preview) so
    // the secret never lands in shell history or CI logs. The file written in a
    // real run still contains the live key — see the .gitignore reminder below.
    const redactKeyForDisplay = (text: string): string => {
      const key = config.apiKey
      if (!key) return text
      const masked = key.length > 12 ? `${key.slice(0, 10)}…${key.slice(-2)}` : '••••'
      return text.split(key).join(masked)
    }

    // Resolve a human-readable project slug: prefer --project-slug, then fetch
    // the project name from the API and slugify it, falling back to the ID prefix.
    let slug: string
    if (opts.projectSlug) {
      slug = opts.projectSlug
    } else {
      // Try to fetch the project name for a nicer server key.
      try {
        const res = await fetch(
          `${config.endpoint?.replace(/\/$/, '')}/v1/admin/mcp/projects`,
          {
            headers: {
              'X-Mushi-Api-Key': config.apiKey ?? '',
              'X-Mushi-Project': config.projectId ?? '',
            },
            signal: AbortSignal.timeout(5000),
          },
        )
        if (res.ok) {
          const body = await res.json() as { ok: boolean; data?: { projects: Array<{ id: string; name?: string | null }> } }
          const project = body?.data?.projects?.find((p) => p.id === config.projectId)
          if (project?.name) {
            slug = project.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 24)
          } else {
            slug = config.projectId?.slice(0, 8) ?? 'mushi'
          }
        } else {
          slug = config.projectId?.slice(0, 8) ?? 'mushi'
        }
      } catch {
        slug = config.projectId?.slice(0, 8) ?? 'mushi'
      }
    }

    const IDE_CONFIG: Record<string, { dir: string; file: string; format: 'mcp-json' | 'zed' }> = {
      cursor:   { dir: '.cursor',                       file: 'mcp.json', format: 'mcp-json' },
      claude:   { dir: '.claude',                        file: 'mcp.json', format: 'mcp-json' },
      continue: { dir: '.continue',                      file: 'mcp.json', format: 'mcp-json' },
      zed:      { dir: nodePath.join(os.homedir(), '.config', 'zed'), file: 'settings.json', format: 'zed' },
    }

    const ideEntry = IDE_CONFIG[opts.ide]
    if (!ideEntry) {
      process.stderr.write(`error: unsupported IDE "${opts.ide}". Supported: ${Object.keys(IDE_CONFIG).join(', ')}\n`)
      process.exit(2)
    }

    const cwd = process.cwd()

    // ── --all-projects: fetch every accessible project and build one server entry each ──
    type ProjectEntry = { id: string; name?: string | null }
    let allProjectsList: ProjectEntry[] | null = null
    if (opts.allProjects && config.endpoint && config.apiKey) {
      try {
        const res = await fetch(
          `${config.endpoint.replace(/\/$/, '')}/v1/admin/mcp/projects`,
          {
            headers: { 'X-Mushi-Api-Key': config.apiKey, 'X-Mushi-Project': config.projectId ?? '' },
            signal: AbortSignal.timeout(8000),
          },
        )
        if (res.ok) {
          const body = await res.json() as { ok: boolean; data?: { projects: ProjectEntry[] } }
          allProjectsList = body?.data?.projects ?? []
        }
      } catch { /* fall through to single-project mode */ }
    }

    const serverName = `mushi-${slug}`

    const mcpServerBlock = {
      command: 'npx',
      args: ['-y', '@mushi-mushi/mcp@latest'],
      env: {
        MUSHI_API_ENDPOINT: config.endpoint,
        MUSHI_PROJECT_ID: config.projectId ?? '',
        MUSHI_API_KEY: config.apiKey,
      },
    }

    const configDir = ideEntry.dir.startsWith('/')
      ? ideEntry.dir
      : nodePath.join(cwd, ideEntry.dir)
    const configPath = nodePath.join(configDir, ideEntry.file)

    if (ideEntry.format === 'mcp-json') {
      if (allProjectsList && allProjectsList.length > 0) {
        // --all-projects: upsert one entry per project using the shared helper
        for (const p of allProjectsList) {
          const pServerName = buildMcpServerName({ projectId: p.id, projectName: p.name ?? undefined })
          const pBlock = buildMcpServerBlock({
            endpoint: config.endpoint,
            projectId: p.id,
            apiKey: config.apiKey,
          })
          if (!opts.dryRun) {
            await writeMcpServerEntry({ configPath, serverName: pServerName, serverBlock: pBlock })
          }
        }
        if (opts.dryRun) {
          console.log(`[dry-run] Would add ${allProjectsList.length} mushi-* entries to ${configPath}`)
        } else {
          console.log(`✓ Added ${allProjectsList.length} mushi-* server entries (${allProjectsList.map((p) => p.name ?? p.id.slice(0, 8)).join(', ')})`)
        }
      } else {
        if (opts.dryRun) {
          const preview = JSON.stringify({ mcpServers: { [serverName]: mcpServerBlock } }, null, 2) + '\n'
          console.log(`[dry-run] Would write ${configPath}:`)
          console.log(redactKeyForDisplay(preview))
        } else {
          await writeMcpServerEntry({ configPath, serverName, serverBlock: mcpServerBlock })
          console.log(`✓ Written ${configPath}`)
        }
      }
    } else if (ideEntry.format === 'zed') {
      let settings: Record<string, unknown> = {}
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf8')
          settings = JSON.parse(raw) as Record<string, unknown>
        } catch { /* start fresh */ }
      }
      const servers = (settings.context_servers as Record<string, unknown>) ?? {}
      servers[serverName] = {
        command: {
          path: 'npx',
          args: ['-y', '@mushi-mushi/mcp@latest'],
          env: {
            MUSHI_API_ENDPOINT: config.endpoint,
            MUSHI_PROJECT_ID: config.projectId ?? '',
            MUSHI_API_KEY: config.apiKey,
          },
        },
        settings: {},
      }
      settings.context_servers = servers
      const output = JSON.stringify(settings, null, 2) + '\n'
      if (opts.dryRun) {
        console.log(`[dry-run] Would write ${configPath}:`)
        console.log(redactKeyForDisplay(output))
      } else {
        await mkdir(configDir, { recursive: true })
        await writeFile(configPath, output, 'utf8')
        console.log(`✓ Written ${configPath}`)
      }
    }

    if (opts.withRules) {
      const rulesContent = [
        '# Mushi Mushi — evolution-loop coding rules',
        '#',
        '# These rules are generated from your project\'s live lesson library.',
        '# Run `mushi sync-lessons` to refresh .mushi/lessons.json',
        '# The MCP server (mushi tools) also injects lessons dynamically at fix time.',
        '',
        '## Before writing a fix',
        '',
        '1. Call `get_fix_context` (MCP) for the report — get root cause + blast radius first.',
        '2. Call `list_lessons` (MCP) or read .mushi/lessons.json — apply every matching rule.',
        '3. Prefer the smallest change that makes the test pass. Don\'t refactor unrelated code.',
        '',
        '## After writing a fix',
        '',
        '1. Call `submit_fix_result` (MCP) with the branch, PR URL, and files changed.',
        '2. The judge batch will score the fix overnight — high-frequency lessons surface in /admin/lessons.',
        '',
        '## Mushi lesson library (auto-updated by `mushi sync-lessons`)',
        '',
        '<!-- lessons synced from .mushi/lessons.json -->',
        '<!-- run `mushi sync-lessons` to refresh -->',
        '',
      ].join('\n')

      if (opts.ide === 'cursor') {
        const rulesPath = nodePath.join(cwd, '.cursorrules')
        if (opts.dryRun) {
          console.log(`[dry-run] Would write ${rulesPath}`)
        } else {
          await writeFile(rulesPath, rulesContent, 'utf8')
          console.log(`✓ Written .cursorrules`)
        }
      } else if (opts.ide === 'claude') {
        const rulesDir = nodePath.join(cwd, '.claude', 'rules')
        const rulesPath = nodePath.join(rulesDir, 'mushi.md')
        if (opts.dryRun) {
          console.log(`[dry-run] Would write ${rulesPath}`)
        } else {
          await mkdir(rulesDir, { recursive: true })
          await writeFile(rulesPath, rulesContent, 'utf8')
          console.log(`✓ Written .claude/rules/mushi.md`)
        }
      }
    }

    if (!opts.dryRun) {
      // ── Key scope validation (default-on, suppressed with --no-verify) ───────
      // Probes /v1/admin/mcp/account-overview — the canonical lightweight
      // mcp:read endpoint — to confirm the configured key can actually drive the
      // MCP server. Fails gracefully so a network hiccup never blocks the user.
      const shouldVerify = opts.verify !== false
      if (shouldVerify && config.endpoint && config.apiKey && config.projectId) {
        try {
          const probeRes = await fetch(
            `${config.endpoint.replace(/\/$/, '')}/v1/admin/mcp/account-overview`,
            {
              headers: {
                'X-Mushi-Api-Key': config.apiKey,
                'X-Mushi-Project': config.projectId,
              },
              signal: AbortSignal.timeout(6000),
            },
          )
          if (probeRes.ok) {
            console.log('✓ MCP key valid — restart Cursor (or your IDE) to activate')
            // Fire-and-forget: signal mcp_setup_done to the backend for funnel tracking.
            void fetch(
              `${config.endpoint.replace(/\/$/, '')}/v1/cli/funnel`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Mushi-Api-Key': config.apiKey,
                  'X-Mushi-Project': config.projectId,
                },
                body: JSON.stringify({ event: 'mcp_setup_done', source: 'cli' }),
                signal: AbortSignal.timeout(4000),
              },
            ).catch(() => { /* best-effort */ })
          } else if (probeRes.status === 403) {
            let errCode: string | undefined
            try {
              const b = await probeRes.json() as { error?: { code?: string } }
              errCode = b?.error?.code
            } catch { /* ignore */ }
            if (errCode === 'INSUFFICIENT_SCOPE') {
              console.log('\n⚠  Your key has report:write scope only — MCP admin tools will not work.')
              console.log('   New keys minted by the wizard include both scopes automatically.')
              console.log('   To upgrade an existing key, run:\n')
              console.log('     mushi login --upgrade-scope\n')
            } else {
              console.log(`⚠  Key probe returned HTTP ${probeRes.status} — check your credentials.`)
            }
          }
        } catch (probeErr) {
          console.warn(
            '[mushi setup] API key probe failed — verify credentials manually.',
            probeErr instanceof Error ? probeErr.message : probeErr,
          )
        }
      }

      console.log('')
      console.log(`Done! Restart ${opts.ide === 'cursor' ? 'Cursor' : opts.ide === 'claude' ? 'Claude Code' : opts.ide} and ask: "list mushi tools"`)
      if (!opts.withRules) {
        console.log(`Tip: run with --with-rules to also write the lesson-library coding hook.`)
      }
      // Security reminder — the config file contains the API key in plaintext.
      const configRelPath = ideEntry.dir.startsWith('/')
        ? configPath
        : nodePath.relative(cwd, configPath)
      console.log(`\nNote: ${configRelPath} contains your Mushi API key — add it to .gitignore if this is a shared repo.`)
    }
  })

}
