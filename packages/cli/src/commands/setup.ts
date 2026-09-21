import type { Command } from 'commander';
import { join } from 'node:path';
import { requireConfig } from '../cli-shared.js';
import { CONFIG_PATH, loadConfig } from '../config.js';
import { resolveCloudEndpoint } from '../endpoint.js';
import { runLogin } from '../login.js';
import {
  buildHostedMcpServerBlock,
  buildMcpServerBlock,
  buildMcpServerName,
  isMcpClient,
  MCP_CLIENT_LABEL,
  MCP_CLIENTS,
  printKeyExportHint,
  writeMcpServerEntry,
  type McpClient,
  type McpServerEntry,
} from '../mcp-config.js';
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

export interface McpConfigTarget {
  /** Directory the file lives in (created on write). */
  dir: string
  /** Absolute path of the file `mushi setup` merges into. */
  path: string
  format: 'mcp-json' | 'zed'
  /** True when the file sits inside the repo (vs the user's home dir). */
  repoLocal: boolean
}

/** Where each MCP client reads its server list from. */
export function resolveMcpConfigTarget(ide: McpClient, cwd: string, home: string): McpConfigTarget {
  switch (ide) {
    case 'cursor':
      return { dir: join(cwd, '.cursor'), path: join(cwd, '.cursor', 'mcp.json'), format: 'mcp-json', repoLocal: true }
    case 'claude':
      // Claude Code reads project-scoped servers from `.mcp.json` at the repo
      // root — the file `claude mcp add --scope project` writes. It never
      // reads `.claude/mcp.json`, so an entry written there is silently lost.
      return { dir: cwd, path: join(cwd, '.mcp.json'), format: 'mcp-json', repoLocal: true }
    case 'continue':
      return { dir: join(cwd, '.continue'), path: join(cwd, '.continue', 'mcp.json'), format: 'mcp-json', repoLocal: true }
    case 'zed':
      return {
        dir: join(home, '.config', 'zed'),
        path: join(home, '.config', 'zed', 'settings.json'),
        format: 'zed',
        repoLocal: false,
      }
  }
}

/**
 * The hosted MCP function is a sibling of the API function:
 * …/functions/v1/api → …/functions/v1/mcp. If the configured endpoint does
 * not end in /api (assertEndpoint allows arbitrary paths), no sibling URL can
 * be derived — writing the API URL as an MCP server would break sign-in.
 */
export function deriveHostedMcpUrl(endpoint: string): string | null {
  return /\/api\/?$/.test(endpoint) ? endpoint.replace(/\/api\/?$/, '/mcp') : null
}

export interface SetupServerBlock {
  block: McpServerEntry
  /** True for the URL-only OAuth entry (no key anywhere on disk). */
  hosted: boolean
  /** Printed when the caller asked for hosted but it could not be derived. */
  note?: string
}

/**
 * Pick the entry `mushi setup` writes for one project. Default for cursor and
 * claude is the hosted MCP URL: the IDE drives the browser OAuth (PKCE)
 * consent flow on first use and stores a revocable key itself. --stdio/--ci
 * opts back into the local subprocess entry (headless environments can't open
 * a browser; --all-projects needs one keyed entry per project, which OAuth's
 * consent-time project pick doesn't cover).
 */
export function buildSetupServerBlock(opts: {
  ide: McpClient
  endpoint: string
  projectId: string
  apiKey: string
  stdio: boolean
  allProjects: boolean
  inlineKey: boolean
}): SetupServerBlock {
  const stdioBlock = buildMcpServerBlock({
    endpoint: opts.endpoint,
    projectId: opts.projectId,
    apiKey: opts.apiKey,
    client: opts.ide,
    inlineKey: opts.inlineKey,
  })
  const wantsHosted = (opts.ide === 'cursor' || opts.ide === 'claude') && !opts.stdio && !opts.allProjects
  if (!wantsHosted) return { block: stdioBlock, hosted: false }
  const hostedUrl = deriveHostedMcpUrl(opts.endpoint)
  if (!hostedUrl) {
    return {
      block: stdioBlock,
      hosted: false,
      note: 'Note: endpoint does not end in /api — cannot derive the hosted MCP URL; writing a local stdio entry instead.',
    }
  }
  // NO Authorization header here — a static header tells the client OAuth
  // isn't needed and disables the login flow (see mcp-config.ts).
  return { block: buildHostedMcpServerBlock(hostedUrl), hosted: true }
}

/** Zed nests the stdio spec under `command` inside `context_servers`. */
function buildZedServerBlock(opts: {
  endpoint: string
  projectId: string
  apiKey: string
  inlineKey: boolean
}): Record<string, unknown> {
  const { env } = buildMcpServerBlock({ ...opts, client: 'zed' })
  return {
    command: { path: 'npx', args: ['-y', MUSHI_MCP_PIN_SPEC], env },
    settings: {},
  }
}

function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
}

export function registerSetupCommands(program: Command): void {
// ─── setup ────────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description(`Wire the Mushi MCP server into Cursor, Claude Code, Continue or Zed (reads ${CONFIG_PATH} — signs you in first if needed)`)
  .option('--ide <ide>', `Target IDE: ${MCP_CLIENTS.join(' | ')}`, 'cursor')
  .option('--project-slug <slug>', 'Override the project slug in the server name (default: fetched from API or ID prefix)')
  .option('--all-projects', 'Write a separate mushi-<name> server entry for every accessible project')
  .option('--with-rules', 'Also write the .cursorrules / .claude/rules/mushi.md lesson-library hook')
  .option('--dry-run', 'Print what would be written without making changes (never signs in or saves anything)')
  .option('--verify', 'Probe the MCP key after writing to confirm it has mcp:read scope (default: on)')
  .option('--no-verify', 'Skip the post-write key probe')
  .option('--endpoint <url>', 'Override the Mushi API endpoint (self-hosted) — used for first-run login if not yet configured')
  .option('--stdio', 'Write a local stdio entry instead of the hosted OAuth URL (cursor/claude default is hosted OAuth — no key on disk)')
  .option('--ci', 'Alias for --stdio: headless environments cannot drive the browser OAuth flow')
  .option('--inline-key', 'Write the literal API key into the stdio env block (default: no key in the file — the server reads your saved CLI key)')
  .addHelpText('after', `
Examples:
  mushi setup                         # wire Cursor (default: hosted OAuth — sign in from the IDE, no key on disk)
  mushi setup --ide claude            # wire Claude Code (.mcp.json at the repo root)
  mushi setup --stdio                 # local stdio entry that reads your saved CLI key
  mushi setup --ci                    # same as --stdio, for headless/CI environments
  mushi setup --all-projects          # one server entry per accessible project (stdio)
  mushi setup --ide cursor --with-rules  # also write .cursorrules
  mushi setup --ide claude --dry-run  # preview the entry; signs nothing in, writes nothing

Supported IDEs:
  cursor    — merges into .cursor/mcp.json
  claude    — merges into .mcp.json at the repo root (Claude Code project scope)
  continue  — merges into .continue/mcp.json (stdio only)
  zed       — merges into ~/.config/zed/settings.json context_servers (stdio only)

For cursor and claude the default entry is the hosted MCP URL: your IDE opens
the browser consent page on first use (OAuth + PKCE) and stores a revocable
key for you — nothing sensitive is written to the repo. Pass --stdio/--ci to
get the local subprocess entry instead; it reads the key from the CLI config
unless you pass --inline-key.

Credentials are read from the CLI config at:
  ${CONFIG_PATH}
If you are not signed in yet, setup runs browser sign-in first, then writes the MCP config.`)
  .action(async (opts: { ide: string; projectSlug?: string; allProjects?: boolean; withRules?: boolean; dryRun?: boolean; verify?: boolean; endpoint?: string; stdio?: boolean; ci?: boolean; inlineKey?: boolean }) => {
    const { writeFile, mkdir, readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const os = await import('node:os')

    const ide = opts.ide
    if (!isMcpClient(ide)) {
      process.stderr.write(`error: unsupported IDE "${opts.ide}". Supported: ${MCP_CLIENTS.join(', ')}\n`)
      process.exit(2)
    }
    const ideLabel = MCP_CLIENT_LABEL[ide]
    const cwd = process.cwd()
    const target = resolveMcpConfigTarget(ide, cwd, os.homedir())
    const configPath = target.path
    const inlineKey = Boolean(opts.inlineKey)
    const useStdio = Boolean(opts.stdio || opts.ci)

    // First-run: no credentials yet — trigger the same device-auth flow as
    // `mushi login` inline instead of erroring out, so `npx mushi-mushi setup`
    // is a true one-command onboarding path. Preserve a pre-configured
    // self-hosted endpoint (config.json or MUSHI_API_ENDPOINT) when the
    // caller didn't pass --endpoint explicitly, so this never silently
    // redirects device-auth to the default cloud endpoint.
    const existingConfig = loadConfig()
    if (!existingConfig.apiKey) {
      const endpoint = resolveLoginEndpoint(opts.endpoint, existingConfig.endpoint, process.env.MUSHI_API_ENDPOINT)
      if (opts.dryRun) {
        // A dry run is the preview a cautious developer or a CI job uses: it
        // must not start device-auth, mint a client id or write any file.
        // Render the entry with placeholders instead.
        const { block } = buildSetupServerBlock({
          ide,
          endpoint: resolveCloudEndpoint(endpoint),
          projectId: '<project-id>',
          apiKey: 'mushi_…',
          stdio: useStdio,
          allProjects: Boolean(opts.allProjects),
          inlineKey,
        })
        const name = `mushi-${opts.projectSlug ?? '<project>'}`
        const preview = target.format === 'zed'
          ? { context_servers: { [name]: buildZedServerBlock({ endpoint: resolveCloudEndpoint(endpoint), projectId: '<project-id>', apiKey: 'mushi_…', inlineKey }) } }
          : { mcpServers: { [name]: block } }
        console.log('[dry-run] Not signed in — a real run starts browser sign-in first. Nothing was sent or saved.')
        console.log(`[dry-run] Would merge into ${configPath}:`)
        console.log(JSON.stringify(preview, null, 2))
        return
      }
      await runLogin({ endpoint, suppressPostLoginBanner: true })
      console.log('  Continuing MCP setup…')
      console.log('')
    }

    const config = requireConfig({ needsProject: true })

    // Mask the API key when echoing config to the terminal (dry-run preview) so
    // the secret never lands in shell history or CI logs. The file written in a
    // real run only contains the key with --inline-key.
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
          slug = project?.name ? slugifyProjectName(project.name) : config.projectId?.slice(0, 8) ?? 'mushi'
        } else {
          slug = config.projectId?.slice(0, 8) ?? 'mushi'
        }
      } catch {
        slug = config.projectId?.slice(0, 8) ?? 'mushi'
      }
    }

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

    const { block: chosenBlock, hosted: useHostedOauth, note } = buildSetupServerBlock({
      ide,
      endpoint: config.endpoint,
      projectId: config.projectId ?? '',
      apiKey: config.apiKey,
      stdio: useStdio,
      allProjects: Boolean(opts.allProjects),
      inlineKey,
    })
    if (note) console.log(note)

    if (target.format === 'mcp-json') {
      if (allProjectsList && allProjectsList.length > 0) {
        // --all-projects: upsert one entry per project using the shared helper
        for (const p of allProjectsList) {
          const pServerName = buildMcpServerName({ projectId: p.id, projectName: p.name ?? undefined })
          const pBlock = buildMcpServerBlock({
            endpoint: config.endpoint,
            projectId: p.id,
            apiKey: config.apiKey,
            client: ide,
            inlineKey,
          })
          if (!opts.dryRun) {
            await writeMcpServerEntry({ configPath, serverName: pServerName, serverBlock: pBlock })
          }
        }
        if (opts.dryRun) {
          console.log(`[dry-run] Would add ${allProjectsList.length} mushi-* entries to ${configPath}`)
        } else {
          console.log(`✓ Added ${allProjectsList.length} mushi-* server entries (${allProjectsList.map((p) => p.name ?? p.id.slice(0, 8)).join(', ')})`)
          if (!inlineKey) printKeyExportHint(ide)
        }
      } else {
        if (opts.dryRun) {
          const preview = JSON.stringify({ mcpServers: { [serverName]: chosenBlock } }, null, 2) + '\n'
          console.log(`[dry-run] Would merge into ${configPath}:`)
          console.log(redactKeyForDisplay(preview))
        } else {
          await writeMcpServerEntry({ configPath, serverName, serverBlock: chosenBlock })
          console.log(`✓ Written ${configPath}`)
          if (useHostedOauth) {
            console.log('  Hosted MCP with OAuth login — no API key was written to this file.')
            console.log(`  Restart ${ideLabel}, open the MCP panel (/mcp in Claude Code), pick "${serverName}" and sign in via the browser.`)
            if (ide === 'claude') {
              console.log('  Claude Code asks you to approve servers from .mcp.json the first time — approve this one.')
            }
            console.log('  Prefer a local key-based entry (headless/CI)? Re-run with --stdio.')
          } else if (!inlineKey) {
            printKeyExportHint(ide)
          }
        }
      }
    } else {
      let settings: Record<string, unknown> = {}
      let raw: string | null = null
      try {
        raw = await readFile(configPath, 'utf8')
      } catch { /* no settings file yet */ }
      if (raw !== null && raw.trim() !== '') {
        try {
          settings = JSON.parse(raw) as Record<string, unknown>
        } catch {
          // Zed's settings.json holds the user's whole editor config; never
          // replace a file we could not parse (it may use comments).
          process.stderr.write(`error: ${configPath} is not plain JSON — add the "${serverName}" entry by hand (run with --dry-run to print it).\n`)
          process.exit(1)
        }
      }
      const servers = (settings.context_servers as Record<string, unknown>) ?? {}
      servers[serverName] = buildZedServerBlock({
        endpoint: config.endpoint,
        projectId: config.projectId ?? '',
        apiKey: config.apiKey,
        inlineKey,
      })
      settings.context_servers = servers
      const output = JSON.stringify(settings, null, 2) + '\n'
      if (opts.dryRun) {
        console.log(`[dry-run] Would write ${configPath}:`)
        console.log(redactKeyForDisplay(output))
      } else {
        await mkdir(target.dir, { recursive: true })
        await writeFile(configPath, output, 'utf8')
        console.log(`✓ Written ${configPath}`)
        if (!inlineKey) printKeyExportHint(ide)
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

      if (ide === 'cursor') {
        const rulesPath = nodePath.join(cwd, '.cursorrules')
        if (opts.dryRun) {
          console.log(`[dry-run] Would write ${rulesPath}`)
        } else {
          await writeFile(rulesPath, rulesContent, 'utf8')
          console.log(`✓ Written .cursorrules`)
        }
      } else if (ide === 'claude') {
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
            console.log(`✓ MCP key valid — restart ${ideLabel} to activate`)
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
                  if (fresh.apiKey && target.format === 'mcp-json' && !allProjectsList) {
                    await writeMcpServerEntry({
                      configPath,
                      serverName,
                      serverBlock: buildMcpServerBlock({
                        endpoint: fresh.endpoint ?? config.endpoint,
                        projectId: fresh.projectId ?? config.projectId ?? '',
                        apiKey: fresh.apiKey,
                        client: ide,
                        inlineKey,
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
                      console.log(`✓ MCP key valid — restart ${ideLabel} to activate`)
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
      console.log(`Done! Restart ${ideLabel} and ask: "list mushi tools"`)
      if (!opts.withRules) {
        console.log(`Tip: run with --with-rules to also write the lesson-library coding hook.`)
      }
      // Only an --inline-key entry holds a secret. Hosted-OAuth entries are
      // URL-only and default stdio entries carry a placeholder (or no key at
      // all) — committing those is how a team shares the MCP hookup, and the
      // Claude Code target is the shared repo-root .mcp.json, so never
      // gitignore them.
      const configRelPath = target.repoLocal
        ? nodePath.relative(cwd, configPath)
        : configPath
      if (!inlineKey) {
        console.log(`\nNote: ${configRelPath} holds no secrets — safe to commit and share with your team.`)
      } else if (target.repoLocal) {
        const gitignorePath = nodePath.join(cwd, '.gitignore')
        const ignoreLine = configRelPath.replaceAll('\\', '/')
        try {
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
