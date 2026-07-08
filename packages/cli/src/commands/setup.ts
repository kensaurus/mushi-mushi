import type { Command } from 'commander';
import { requireConfig } from '../cli-shared.js';
import { loadConfig } from '../config.js';
import { runLogin } from '../login.js';
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from '../mcp-config.js';
import { MUSHI_MCP_PIN_SPEC } from '../version.js';

// Exported for unit testing — resolving the login endpoint has three sources
// of truth and a wrong precedence here silently redirects a self-hosted
// user's device-auth to the default cloud endpoint (see setup.test.ts).
export function resolveLoginEndpoint(
  optsEndpoint: string | undefined,
  existingConfigEndpoint: string | undefined,
  envEndpoint: string | undefined,
): string | undefined {
  return optsEndpoint ?? existingConfigEndpoint ?? envEndpoint?.trim()
}

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
  .option('--endpoint <url>', 'Override the Mushi API endpoint (self-hosted) — used for first-run login if not yet configured')
  .option('--stdio', 'Write a local stdio entry with an API key instead of the hosted OAuth URL (cursor/claude default is hosted OAuth — no key on disk)')
  .option('--ci', 'Alias for --stdio: headless environments cannot drive the browser OAuth flow')
  .addHelpText('after', `
Examples:
  mushi setup                         # wire Cursor (default: hosted OAuth — sign in from the IDE, no key on disk)
  mushi setup --stdio                 # local stdio entry with an API key (previous behavior)
  mushi setup --ci                    # same as --stdio, for headless/CI environments
  mushi setup --all-projects          # one server entry per accessible project (stdio)
  mushi setup --ide claude            # wire Claude Code
  mushi setup --ide cursor --with-rules  # also write .cursorrules

Supported IDEs:
  cursor    — writes .cursor/mcp.json
  claude    — writes .claude/mcp.json (Claude Code / Claude Desktop)
  continue  — writes .continue/mcp.json (stdio only)
  zed       — writes ~/.config/zed/settings.json mcpServers block (stdio only)

For cursor and claude the default entry is the hosted MCP URL: your IDE opens
the browser consent page on first use (OAuth + PKCE) and stores a revocable
key for you — nothing sensitive is written to the repo. Pass --stdio/--ci to
get the local subprocess entry with an API key instead.

The command reads credentials from ~/.config/mushi/config.json. If you are not logged in yet, it runs browser sign-in first, then writes MCP config.`)
  .action(async (opts: { ide: string; projectSlug?: string; allProjects?: boolean; withRules?: boolean; dryRun?: boolean; verify?: boolean; endpoint?: string; stdio?: boolean; ci?: boolean }) => {
    const { writeFile, mkdir, readFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const os = await import('node:os')

    // First-run: no credentials yet — trigger the same device-auth flow as
    // `mushi login` inline instead of erroring out, so `npx mushi-mushi setup`
    // is a true one-command onboarding path. Preserve a pre-configured
    // self-hosted endpoint (config.json or MUSHI_API_ENDPOINT) when the
    // caller didn't pass --endpoint explicitly, so this never silently
    // redirects device-auth to the default cloud endpoint.
    const existingConfig = loadConfig()
    if (!existingConfig.apiKey) {
      const endpoint = resolveLoginEndpoint(opts.endpoint, existingConfig.endpoint, process.env.MUSHI_API_ENDPOINT)
      await runLogin({ endpoint, suppressPostLoginBanner: true })
      console.log('  Continuing MCP setup…')
      console.log('')
    }

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

    // ── Hosted OAuth vs local stdio ──────────────────────────────────────
    // Default for cursor/claude is the hosted MCP URL: the IDE drives the
    // browser OAuth (PKCE) consent flow on first use and stores a revocable
    // key itself — no API key lands in the repo's mcp.json. --stdio/--ci
    // opts back into the local subprocess entry (headless environments
    // can't open a browser; --all-projects needs one keyed entry per
    // project, which OAuth's consent-time project pick doesn't cover).
    const useHostedOauth =
      (opts.ide === 'cursor' || opts.ide === 'claude') &&
      !opts.stdio && !opts.ci && !opts.allProjects
    // The hosted MCP function is a sibling of the API function:
    // …/functions/v1/api → …/functions/v1/mcp
    const hostedMcpUrl = (config.endpoint ?? '').replace(/\/api\/?$/, '/mcp')
    // NO Authorization header here — a static header tells the client OAuth
    // isn't needed and disables the login flow (see mcp-config.ts).
    const hostedServerBlock = { url: hostedMcpUrl }

    const mcpServerBlock = {
      command: 'npx',
      args: ['-y', MUSHI_MCP_PIN_SPEC],
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
        const chosenBlock = useHostedOauth ? hostedServerBlock : mcpServerBlock
        if (opts.dryRun) {
          const preview = JSON.stringify({ mcpServers: { [serverName]: chosenBlock } }, null, 2) + '\n'
          console.log(`[dry-run] Would write ${configPath}:`)
          console.log(redactKeyForDisplay(preview))
        } else {
          await writeMcpServerEntry({ configPath, serverName, serverBlock: chosenBlock })
          console.log(`✓ Written ${configPath}`)
          if (useHostedOauth) {
            console.log('  Hosted MCP with OAuth login — no API key was written to this file.')
            console.log(`  Restart ${opts.ide === 'cursor' ? 'Cursor' : 'Claude Code'}, open the MCP panel (/mcp in Claude Code), pick "${serverName}" and sign in via the browser.`)
            console.log('  Prefer a local key-based entry (headless/CI)? Re-run with --stdio.')
          }
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
          args: ['-y', MUSHI_MCP_PIN_SPEC],
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
      // Hosted-OAuth entries carry no key — the probe would validate the CLI's
      // saved key, which is not what the IDE will use. Skip it; the sign-in
      // guidance above is the verification path.
      const shouldVerify = opts.verify !== false && !useHostedOauth
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
            // Opt out with MUSHI_NO_TELEMETRY=1.
            if (!process.env.MUSHI_NO_TELEMETRY) void fetch(
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
              // Fix it inline instead of sending the user to a second command:
              // upgrade the key via browser sign-in, rewrite the IDE config
              // with the new key, and re-probe. (Interactive terminals only.)
              const canPrompt = process.stdin.isTTY && process.stdout.isTTY
              let upgraded = false
              if (canPrompt) {
                const { createInterface } = await import('node:readline')
                const rl = createInterface({ input: process.stdin, output: process.stdout })
                const answer = await new Promise<string>((resolve) =>
                  rl.question('   Upgrade this key now via browser sign-in? [Y/n] ', (a) => resolve(a.trim().toLowerCase())),
                )
                rl.close()
                if (answer === '' || answer === 'y' || answer === 'yes') {
                  await runLogin({ endpoint: opts.endpoint, upgradeScope: true, suppressPostLoginBanner: true })
                  const fresh = loadConfig()
                  if (fresh.apiKey && ideEntry.format === 'mcp-json' && !allProjectsList) {
                    await writeMcpServerEntry({
                      configPath,
                      serverName,
                      serverBlock: buildMcpServerBlock({
                        endpoint: fresh.endpoint ?? config.endpoint,
                        projectId: fresh.projectId ?? config.projectId ?? '',
                        apiKey: fresh.apiKey,
                      }),
                    })
                    console.log(`✓ Rewrote ${configPath} with the upgraded key`)
                    const reprobe = await fetch(
                      `${(fresh.endpoint ?? config.endpoint)?.replace(/\/$/, '')}/v1/admin/mcp/account-overview`,
                      {
                        headers: {
                          'X-Mushi-Api-Key': fresh.apiKey,
                          'X-Mushi-Project': fresh.projectId ?? config.projectId ?? '',
                        },
                        signal: AbortSignal.timeout(6000),
                      },
                    ).catch(() => null)
                    if (reprobe?.ok) {
                      upgraded = true
                      console.log('✓ MCP key valid — restart Cursor (or your IDE) to activate')
                    } else {
                      console.log(`⚠  Re-probe after upgrade returned HTTP ${reprobe?.status ?? 'error'} — run \`mushi doctor --mcp\`.`)
                    }
                  } else if (fresh.apiKey) {
                    console.log('✓ Key upgraded — re-run `mushi setup` to rewrite the IDE config with it.')
                  }
                }
              }
              if (!upgraded && !canPrompt) {
                console.log('   To upgrade this key, run:\n')
                console.log('     mushi login --upgrade-scope\n')
              }
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
      // Security: a stdio config file contains the API key in plaintext. For
      // repo-local configs, append it to .gitignore ourselves (idempotent)
      // instead of hoping the user reads a reminder. Hosted-OAuth entries are
      // the opposite case: URL-only, no secret — committing them is how a
      // team shares the MCP hookup, so don't gitignore those.
      const configRelPath = ideEntry.dir.startsWith('/')
        ? configPath
        : nodePath.relative(cwd, configPath)
      if (useHostedOauth) {
        console.log(`\nNote: ${configRelPath} holds no secrets (OAuth login) — safe to commit and share with your team.`)
      } else if (!ideEntry.dir.startsWith('/')) {
        const gitignorePath = nodePath.join(cwd, '.gitignore')
        const ignoreLine = configRelPath.replaceAll('\\', '/')
        try {
          const { readFile, writeFile } = await import('node:fs/promises')
          const existing = await readFile(gitignorePath, 'utf8').catch(() => '')
          const lines = existing.split(/\r?\n/)
          if (!lines.some((l) => l.trim() === ignoreLine)) {
            const sep = existing.endsWith('\n') || existing === '' ? '' : '\n'
            await writeFile(
              gitignorePath,
              `${existing}${sep}# Mushi MCP config holds a plaintext API key\n${ignoreLine}\n`,
              'utf8',
            )
            console.log(`\n✓ Added ${ignoreLine} to .gitignore (it contains your Mushi API key)`)
          } else {
            console.log(`\nNote: ${ignoreLine} is gitignored (it contains your Mushi API key).`)
          }
        } catch {
          console.log(`\nNote: ${configRelPath} contains your Mushi API key — add it to .gitignore if this is a shared repo.`)
        }
      } else {
        console.log(`\nNote: ${configRelPath} contains your Mushi API key.`)
      }
    }
  })

}
