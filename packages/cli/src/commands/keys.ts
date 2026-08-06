import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall, outputIsJson } from '../cli-shared.js';

export function registerKeysCommands(program: Command): void {
  // ─── BYOK key management CLI ──────────────────────────────────────────────────

  const keys = program.command('keys').description('Manage API key pool (BYOK)');

  keys
    .command('list')
    .description('List all API keys in the pool with their status')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig();
      if (!config.apiKey || !config.projectId) {
        console.error('Run `mushi login` first');
        process.exit(1);
      }

      const res = await apiCall<{
        keys: Array<{
          id: string;
          provider_slug: string;
          label: string | null;
          priority: number;
          status: string;
          key_hint: string | null;
          base_url: string | null;
          test_status: string | null;
          last_tested_at: string | null;
          last_used_at: string | null;
          cooldown_until: string | null;
          created_at: string;
        }>;
        legacyKeys?: Array<{
          id: string;
          provider_slug: string;
          status: string;
          key_hint: string | null;
          test_status: string | null;
          last_tested_at: string | null;
          last_used_at: string | null;
          created_at: string | null;
          legacy: true;
        }>;
      }>(`/v1/admin/byok/keys?project_id=${encodeURIComponent(config.projectId)}`, config);
      if (!res.ok) {
        console.error(`Error: ${res.error.message}`);
        process.exit(1);
      }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      const legacyKeys = res.data.legacyKeys ?? [];
      if (res.data.keys.length === 0 && legacyKeys.length === 0) {
        console.log('No keys configured.');
        return;
      }

      for (const k of res.data.keys) {
        const cooldown =
          k.cooldown_until && new Date(k.cooldown_until) > new Date()
            ? ` [cooldown until ${new Date(k.cooldown_until).toLocaleTimeString()}]`
            : '';
        const validation = k.test_status ? ` test=${k.test_status}` : ' test=required';
        const lastUsed = k.last_used_at
          ? ` last-used=${new Date(k.last_used_at).toISOString()}`
          : '';
        console.log(
          `${k.provider_slug.padEnd(14)} [${k.status}]${validation} p=${k.priority} ${k.label ?? '(no label)'}${cooldown}${lastUsed} — ${k.id}`,
        );
      }

      for (const k of legacyKeys) {
        const validation = k.test_status ? ` test=${k.test_status}` : ' test=required';
        const lastUsed = k.last_used_at
          ? ` last-used=${new Date(k.last_used_at).toISOString()}`
          : '';
        console.log(
          `${k.provider_slug.padEnd(14)} [${k.status}]${validation} legacy${lastUsed} — manage in the console`,
        );
      }
    });

  keys
    .command('add')
    .description('Add a new API key to the pool')
    .requiredOption('--provider <p>', 'Provider: anthropic, openai, firecrawl, browserbase, cursor')
    .option(
      '--key <k>',
      'The API key value (prefer the MUSHI_BYOK_KEY env var to keep it out of shell history)',
    )
    .option('--label <l>', 'Human-readable label')
    .option('--priority <n>', 'Priority (lower = higher priority)', '100')
    .option('--base-url <url>', 'OpenAI-compatible HTTPS base URL (OpenAI provider only)')
    .action(
      async (opts: {
        provider: string;
        key?: string;
        label?: string;
        priority: string;
        baseUrl?: string;
      }) => {
        const config = loadConfig();
        if (!config.apiKey || !config.projectId) {
          console.error('Run `mushi login` first');
          process.exit(1);
        }

        // Prefer the env var so the secret isn't captured in shell history or
        // visible in the process list (`ps`). Fall back to the explicit flag.
        const key = process.env.MUSHI_BYOK_KEY ?? opts.key;
        if (!key) {
          console.error(
            'Provide the key via the MUSHI_BYOK_KEY env var (recommended) or --key <value>.',
          );
          process.exit(1);
        }

        const priority = Number(opts.priority);
        if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
          console.error('Priority must be an integer between 0 and 10000.');
          process.exit(1);
        }

        const res = await apiCall<{
          id: string;
          provider_slug: string;
          status: string;
          test_status: string;
          validation: {
            status: string;
            detail: string;
            httpStatus: number;
            latencyMs: number;
          };
        }>('/v1/admin/byok/keys', config, {
          method: 'POST',
          body: JSON.stringify({
            project_id: config.projectId,
            provider_slug: opts.provider,
            key,
            label: opts.label,
            priority,
            base_url: opts.baseUrl,
          }),
        });
        if (!res.ok) {
          console.error(`Error: ${res.error.message}`);
          process.exit(1);
        }
        if (res.data.validation.status === 'ok') {
          console.log(`✓ Key validated and active — id: ${res.data.id}`);
        } else {
          console.log(
            `! Key saved but quarantined (${res.data.validation.status}) — id: ${res.data.id}`,
          );
          console.log(`  ${res.data.validation.detail}`);
        }
      },
    );

  keys
    .command('test <key-id>')
    .description('Re-test one pooled key and activate it only if validation passes')
    .action(async (keyId: string) => {
      const config = loadConfig();
      if (!config.apiKey || !config.projectId) {
        console.error('Run `mushi login` first');
        process.exit(1);
      }

      const res = await apiCall<{
        key: { id: string; status: string; test_status: string };
        validation: { status: string; detail: string };
      }>(`/v1/admin/byok/keys/${encodeURIComponent(keyId)}/test`, config, { method: 'POST' });
      if (!res.ok) {
        console.error(`Error: ${res.error.message}`);
        process.exit(1);
      }
      if (res.data.validation.status === 'ok') {
        console.log(`✓ Key validated and active — id: ${res.data.key.id}`);
        return;
      }
      console.log(
        `! Key remains quarantined (${res.data.validation.status}) — id: ${res.data.key.id}`,
      );
      console.log(`  ${res.data.validation.detail}`);
    });

  keys
    .command('remove <key-id>')
    .description('Permanently remove one pooled key and its Vault secret')
    .action(async (keyId: string) => {
      const config = loadConfig();
      if (!config.apiKey || !config.projectId) {
        console.error('Run `mushi login` first');
        process.exit(1);
      }

      const res = await apiCall<{ removed: true; keyId: string }>(
        `/v1/admin/byok/keys/${encodeURIComponent(keyId)}`,
        config,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        console.error(`Error: ${res.error.message}`);
        process.exit(1);
      }
      console.log(`✓ Key removed — id: ${keyId}`);
    });
}
