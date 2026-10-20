import type { Command } from 'commander';
import { loadConfig, resolveProfileName, saveConfig } from '../config.js';
import { syncKeychainAfterKeyChange } from '../keychain.js';
import { apiCall, printResult } from '../cli-shared.js';
import { spendDownBody, spendDownStatusLine, type SpendDownFlags, type SpendDownStatusKey } from '../spend-down.js';
import {
  startDeviceAuth,
  waitForCliToken,
  mintProjectKey,
  revokeProjectKey,
} from '../device-auth.js';

export function registerKeysCommands(program: Command): void {
  // ─── BYOK key management CLI ──────────────────────────────────────────────────

  const keys = program.command('keys').description('Manage API key pool (BYOK)');

  keys
    .command('list')
    .description('List all API keys in the pool with their status')
    .option('--json', 'Output as JSON (alias for -o json)')
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
      printResult(res.data, {
        json: opts.json,
        render(d) {
          const legacyKeys = d.legacyKeys ?? [];
          if (d.keys.length === 0 && legacyKeys.length === 0) {
            console.log('No keys configured.');
            return;
          }
          for (const k of d.keys) {
            const cooldown =
              k.cooldown_until && new Date(k.cooldown_until) > new Date()
                ? ` [cooldown until ${new Date(k.cooldown_until).toLocaleTimeString()}]`
                : '';
            const validation = k.test_status ? ` test=${k.test_status}` : ' test=required';
            const lastTested = k.last_tested_at
              ? ` tested=${new Date(k.last_tested_at).toISOString()}`
              : '';
            const lastUsed = k.last_used_at
              ? ` used=${new Date(k.last_used_at).toISOString()}`
              : '';
            const baseUrl = k.base_url ? ` base=${k.base_url}` : '';
            const hint = k.key_hint ? ` hint=${k.key_hint}` : '';
            console.log(
              `${k.provider_slug.padEnd(14)} [${k.status}]${validation} p=${k.priority} ${k.label ?? '(no label)'}${hint}${baseUrl}${cooldown}${lastTested}${lastUsed} created=${new Date(k.created_at).toISOString()} — ${k.id}`,
            );
          }
          for (const k of legacyKeys) {
            const validation = k.test_status ? ` test=${k.test_status}` : ' test=required';
            const lastTested = k.last_tested_at
              ? ` tested=${new Date(k.last_tested_at).toISOString()}`
              : '';
            const lastUsed = k.last_used_at
              ? ` used=${new Date(k.last_used_at).toISOString()}`
              : '';
            const created = k.created_at ? ` created=${new Date(k.created_at).toISOString()}` : '';
            const hint = k.key_hint ? ` hint=${k.key_hint}` : '';
            console.log(
              `${k.provider_slug.padEnd(14)} [${k.status}]${validation} legacy${hint}${lastTested}${lastUsed}${created} — manage in the console`,
            );
          }
        },
      });
    });

  keys
    .command('rotate')
    .description('Rotate the project API key stored in local config (mints a fresh key)')
    .option('--json', 'Output as JSON (alias for -o json)')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig();
      if (!config.projectId) {
        console.error('Run `mushi login` first');
        process.exit(1);
      }
      if (!config.endpoint) {
        console.error('No endpoint configured — run `mushi login` first');
        process.exit(1);
      }

      // Rotation requires authenticating as the project owner.  The stored API
      // key only has report:write / mcp:read scopes — not enough to revoke and
      // re-mint on the server.  We re-run the device auth flow to get a short-
      // lived CLI token, then use it to mint a fresh key for the same project.
      console.log('Authenticating to rotate key…');
      const session = await startDeviceAuth(config.endpoint).catch((err: Error) => {
        console.error(`Error starting auth: ${err.message}`);
        process.exit(1);
      });
      console.log(`\n  Open this URL to confirm rotation:\n  ${session.verification_uri}`);
      console.log(`  Enter code: ${session.user_code}\n`);

      const cliToken = await waitForCliToken(config.endpoint, session).catch((err: Error) => {
        console.error(`Auth failed: ${err.message}`);
        process.exit(1);
      });

      // Preserve the existing key's scopes (mcp:write if previously upgraded).
      const existingScopes: string[] = Array.isArray((config as Record<string, unknown>).scopes)
        ? ((config as Record<string, unknown>).scopes as string[])
        : ['report:write', 'mcp:read'];

      const newKey = await mintProjectKey(config.endpoint, cliToken, config.projectId, {
        label: 'rotated',
        scopes: existingScopes,
      }).catch((err: Error) => {
        console.error(`Could not mint new key: ${err.message}`);
        process.exit(1);
      });

      const oldKey = config.apiKey;
      const oldPrefix = oldKey?.slice(0, 12) ?? '(none)';
      config.apiKey = newKey;
      saveConfig(config);
      // The keychain wins over the file on read; leave the old key there and
      // every command after the revoke below fails with it.
      syncKeychainAfterKeyChange(newKey, resolveProfileName());

      // Auto-revoke the predecessor on the server so the old key cannot be used
      // after rotation. Uses the same CLI token that minted the new key.
      // Errors are non-fatal — the new key is already saved; user can manually
      // revoke the old key in the console if this step fails.
      let serverRevoked = false;
      if (oldKey && config.projectId) {
        const revokeResult = await revokeProjectKey(
          config.endpoint,
          cliToken,
          config.projectId,
          oldPrefix,
        ).catch(() => null);
        serverRevoked = revokeResult?.revoked === 1;
      }

      printResult(
        { newPrefix: newKey.slice(0, 12), oldPrefix, serverRevoked },
        {
          json: opts.json,
          render(d) {
            console.log(`✓ Key rotated.`);
            console.log(`  Old prefix: ${d.oldPrefix}…  →  New prefix: ${d.newPrefix}…`);
            console.log(`  New key saved to local config.`);
            if (d.serverRevoked) {
              console.log(`  ✓ Old key revoked on the server.`);
            } else {
              console.log(
                `  ℹ  Old key may still be active — revoke it at: ${config.consoleUrl ?? 'your Mushi console'} → Settings → API Keys`,
              );
            }
          },
        },
      );
    });

  keys
    .command('add')
    .description('Add a new API key to the pool')
    .requiredOption('--provider <p>', 'Provider: anthropic, openai, openrouter, firecrawl, browserbase, cursor, supabase')
    .option(
      '--key <k>',
      'The API key value (prefer the MUSHI_BYOK_KEY env var to keep it out of shell history)',
    )
    .option('--label <l>', 'Human-readable label')
    .option('--priority <n>', 'Priority (lower = higher priority)', '100')
    .option('--base-url <url>', 'Allow-listed OpenAI-compatible HTTPS base URL')
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
          return;
        }
        console.log(
          `! Key saved but quarantined (${res.data.validation.status}) — id: ${res.data.id}`,
        );
        console.log(`  ${res.data.validation.detail}`);
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
    .command('spend-down [key-id]')
    .description(
      'Spend down expiring Cursor credits on open bugs (ADR 0028): show status, or set it for one key',
    )
    .option('--on', 'Turn spend-down on (needs --expires once)')
    .option('--off', 'Turn spend-down off')
    .option('--expires <date>', 'When the credits expire, YYYY-MM-DD')
    .option('--model <spec>', "Cursor model, e.g. 'grok-4.7?reasoning_effort=xhigh&context=500k' ('' = app default)")
    .option('--per-day <n>', 'Fixes per day across the apps this key pays for (1-200)')
    .option('--window-days <n>', 'Start this many days before the credits expire (1-90)')
    .option('--json', 'Output as JSON (alias for -o json)')
    .action(async (keyId: string | undefined, opts: SpendDownFlags & { json?: boolean }) => {
      const config = loadConfig();
      if (!config.apiKey || !config.projectId) {
        console.error('Run `mushi login` first');
        process.exit(1);
      }
      let body: ReturnType<typeof spendDownBody>;
      try {
        body = spendDownBody(opts);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      if (keyId && body) {
        const res = await apiCall<{ id: string; enabled: boolean; creditsExpireAt: string | null }>(
          `/v1/admin/byok/keys/${encodeURIComponent(keyId)}/spend-down`,
          config,
          { method: 'PATCH', body: JSON.stringify(body) },
        );
        if (!res.ok) {
          console.error(`Error: ${res.error.message}`);
          process.exit(1);
        }
        console.log(
          `✓ Spend-down ${res.data.enabled ? 'on' : 'off'}${res.data.creditsExpireAt ? `, credits expire ${res.data.creditsExpireAt.slice(0, 10)}` : ''} — id: ${res.data.id}`,
        );
        return;
      }
      if (keyId && !body) {
        console.error('Nothing to change: pass --on, --off, --expires, --model, --per-day or --window-days');
        process.exit(1);
      }
      const res = await apiCall<{ keys: SpendDownStatusKey[] }>(
        `/v1/admin/byok/spend-down?project_id=${encodeURIComponent(config.projectId)}`,
        config,
      );
      if (!res.ok) {
        console.error(`Error: ${res.error.message}`);
        process.exit(1);
      }
      printResult(res.data, {
        json: opts.json,
        render(d) {
          if (d.keys.length === 0) {
            console.log('No Cursor key for this project. Add one with `mushi keys add --provider cursor`.');
            return;
          }
          for (const k of d.keys) console.log(spendDownStatusLine(k));
        },
      });
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
      console.log(`✓ Key removed — id: ${res.data.keyId}`);
    });
}
