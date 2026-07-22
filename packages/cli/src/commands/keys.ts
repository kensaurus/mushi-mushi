import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { apiCall, printResult } from '../cli-shared.js';
import { startDeviceAuth, waitForCliToken, mintProjectKey, revokeProjectKey } from '../device-auth.js';

export function registerKeysCommands(program: Command): void {
// ─── BYOK key management CLI ──────────────────────────────────────────────────

const keys = program.command('keys').description('Manage API key pool (BYOK)')

keys
  .command('list')
  .description('List all API keys in the pool with their status')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ keys: Array<{ id: string; provider_slug: string; label: string | null; priority: number; status: string; cooldown_until: string | null }> }>(
      `/v1/admin/byok/keys?project_id=${encodeURIComponent(config.projectId)}`,
      config,
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    printResult(res.data, {
      json: opts.json,
      render(d) {
        if (d.keys.length === 0) { console.log('No keys configured.'); return }
        for (const k of d.keys) {
          const cooldown = k.cooldown_until && new Date(k.cooldown_until) > new Date()
            ? ` [cooldown until ${new Date(k.cooldown_until).toLocaleTimeString()}]`
            : ''
          console.log(`${k.provider_slug.padEnd(14)} [${k.status}] p=${k.priority} ${k.label ?? '(no label)'}${cooldown} — ${k.id}`)
        }
      },
    })
  })

keys
  .command('rotate')
  .description('Rotate the project API key stored in local config (mints a fresh key)')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.endpoint) { console.error('No endpoint configured — run `mushi login` first'); process.exit(1) }

    // Rotation requires authenticating as the project owner.  The stored API
    // key only has report:write / mcp:read scopes — not enough to revoke and
    // re-mint on the server.  We re-run the device auth flow to get a short-
    // lived CLI token, then use it to mint a fresh key for the same project.
    console.log('Authenticating to rotate key…')
    const session = await startDeviceAuth(config.endpoint).catch((err: Error) => {
      console.error(`Error starting auth: ${err.message}`)
      process.exit(1)
    })
    console.log(`\n  Open this URL to confirm rotation:\n  ${session.verification_uri}`)
    console.log(`  Enter code: ${session.user_code}\n`)

    const cliToken = await waitForCliToken(config.endpoint, session).catch((err: Error) => {
      console.error(`Auth failed: ${err.message}`)
      process.exit(1)
    })

    // Preserve the existing key's scopes (mcp:write if previously upgraded).
    const existingScopes: string[] = Array.isArray((config as Record<string, unknown>).scopes)
      ? (config as Record<string, unknown>).scopes as string[]
      : ['report:write', 'mcp:read']

    const newKey = await mintProjectKey(config.endpoint, cliToken, config.projectId, {
      label: 'rotated',
      scopes: existingScopes,
    }).catch((err: Error) => {
      console.error(`Could not mint new key: ${err.message}`)
      process.exit(1)
    })

    const oldKey = config.apiKey
    const oldPrefix = oldKey?.slice(0, 12) ?? '(none)'
    config.apiKey = newKey
    saveConfig(config)

    // Auto-revoke the predecessor on the server so the old key cannot be used
    // after rotation. Uses the same CLI token that minted the new key.
    // Errors are non-fatal — the new key is already saved; user can manually
    // revoke the old key in the console if this step fails.
    let serverRevoked = false
    if (oldKey && config.projectId) {
      const revokeResult = await revokeProjectKey(
        config.endpoint,
        cliToken,
        config.projectId,
        oldPrefix,
      ).catch(() => null)
      serverRevoked = revokeResult?.revoked === 1
    }

    printResult({ newPrefix: newKey.slice(0, 12), oldPrefix, serverRevoked }, {
      json: opts.json,
      render(d) {
        console.log(`✓ Key rotated.`)
        console.log(`  Old prefix: ${d.oldPrefix}…  →  New prefix: ${d.newPrefix}…`)
        console.log(`  New key saved to local config.`)
        if (d.serverRevoked) {
          console.log(`  ✓ Old key revoked on the server.`)
        } else {
          console.log(`  ℹ  Old key may still be active — revoke it at: ${config.consoleUrl ?? 'your Mushi console'} → Settings → API Keys`)
        }
      },
    })
  })

keys
  .command('add')
  .description('Add a new API key to the pool')
  .requiredOption('--provider <p>', 'Provider: anthropic, openai, firecrawl, browserbase, cursor')
  .option('--key <k>', 'The API key value (prefer the MUSHI_BYOK_KEY env var to keep it out of shell history)')
  .option('--label <l>', 'Human-readable label')
  .option('--priority <n>', 'Priority (lower = higher priority)', '100')
  .action(async (opts: { provider: string; key?: string; label?: string; priority: string }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    // Prefer the env var so the secret isn't captured in shell history or
    // visible in the process list (`ps`). Fall back to the explicit flag.
    const key = process.env.MUSHI_BYOK_KEY ?? opts.key
    if (!key) {
      console.error('Provide the key via the MUSHI_BYOK_KEY env var (recommended) or --key <value>.')
      process.exit(1)
    }

    const res = await apiCall<{ id: string }>(
      '/v1/admin/byok/keys',
      config,
      { method: 'POST', body: JSON.stringify({ project_id: config.projectId, provider_slug: opts.provider, key, label: opts.label, priority: parseInt(opts.priority, 10) }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Key added — id: ${res.data.id}`)
  })
}
