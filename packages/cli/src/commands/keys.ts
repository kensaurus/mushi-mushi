import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall, outputIsJson } from '../cli-shared.js';

export function registerKeysCommands(program: Command): void {
// ─── BYOK key management CLI ──────────────────────────────────────────────────

const keys = program.command('keys').description('Manage API key pool (BYOK)')

keys
  .command('list')
  .description('List all API keys in the pool with their status')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ keys: Array<{ id: string; provider_slug: string; label: string | null; priority: number; status: string; cooldown_until: string | null }> }>(
      `/v1/admin/byok/keys?project_id=${encodeURIComponent(config.projectId)}`,
      config,
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    if (outputIsJson(opts.json)) { console.log(JSON.stringify(res.data, null, 2)); return }
    if (res.data.keys.length === 0) { console.log('No keys configured.'); return }

    for (const k of res.data.keys) {
      const cooldown = k.cooldown_until && new Date(k.cooldown_until) > new Date()
        ? ` [cooldown until ${new Date(k.cooldown_until).toLocaleTimeString()}]`
        : ''
      console.log(`${k.provider_slug.padEnd(14)} [${k.status}] p=${k.priority} ${k.label ?? '(no label)'}${cooldown} — ${k.id}`)
    }
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
