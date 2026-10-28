/**
 * FILE: packages/server/supabase/functions/_shared/byok.ts
 * PURPOSE: Resolve effective API keys for all BYOK providers
 *          (Bring-Your-Own-Key, Phase 0 multi-key pool).
 *
 * RESOLUTION ORDER (per provider; ADR 0023, extended by ADR 0031):
 *   1. the app's own byok_keys rows, by priority (skips cooldown/disabled/auth_failed)
 *   2. project_settings.byok_<provider>_key_ref (legacy column — back-compat)
 *   3. its organization's shared byok_keys rows, by priority
 *   4. universal byok_keys rows of its organization's owners, by priority
 *   5. process.env.<PROVIDER>_API_KEY (platform fallback)
 *   Every candidate is returned in that order for withLlmFailover() to iterate.
 *   `resolveLlmKeySource` reports which step would win for one app. It does
 *   not read the secret, write key status, or depend on the caller. A failed
 *   read throws, so a status chip can say the answer is unknown instead of
 *   inventing "no key". `resolveLlmKeySources` answers several providers from
 *   one owner read and one byok_keys read.
 *
 * SECURITY:
 *   - Logs the source ('byok' | 'env') and last-used timestamp; NEVER logs the
 *     key itself or any prefix beyond `sk-…<last 4>`.
 *   - The audit log row in `byok_audit_log` is written best-effort; it MUST
 *     NOT block the LLM call.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import { isRunnableByokPoolState, validateOpenAiBaseUrl, type ByokPoolLifecycleState } from './byok-validation.ts';
import {
  isMissingOwnerUserColumn,
  keyOwnerFilter,
  keyScopeFor,
  ownKeysFirst,
  ownerUserColumnReady,
  projectKeyOwner,
  type KeyOwner,
  type KeyScope,
} from './byok-scope.ts';
import { assertLlmBudget, isBudgetedProvider, LlmBudgetUnavailableError } from './llm-budget.ts';

const log = rootLog.child('byok');

/** All provider slugs supported by BYOK (Phase 0 adds 'cursor'). */
export type LlmProvider = 'anthropic' | 'openai' | 'openrouter' | 'firecrawl' | 'browserbase' | 'cursor';

/** OpenRouter's OpenAI-compatible API root. Model ids there carry a vendor prefix (`openai/gpt-5.4`). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type KeyStatus =
  | 'pending_validation'
  | 'active'
  | 'disabled'
  | 'quota_exhausted'
  | 'auth_failed';

export interface ResolvedKey {
  /** byok_keys row id (null for legacy/env) */
  keyId?: string;
  key: string;
  source: 'byok' | 'env';
  /** Last 4 chars of the key — safe to log. */
  hint: string;
  /**
   * Base URL for OpenAI-compatible calls: the key's own (Together, Azure, …),
   * OpenRouter's for an `openrouter` key, or OpenAI's.
   */
  baseUrl?: string;
  /** The provider the key belongs to when it differs from the one asked for (an OpenRouter key serving an OpenAI-compatible call). */
  provider?: LlmProvider;
  /** Human label if set on the key row */
  label?: string;
  /**
   * True for a key the app does not own: its organization's shared key (ADR
   * 0023) or a universal key of the organization's owner (ADR 0031). Both
   * come after the app's own credentials, legacy included.
   */
  shared?: boolean;
  /** Which pool the key came from; absent for the legacy and platform keys. */
  scope?: KeyScope;
}

/**
 * Which step `resolveLlmKey` would use for this app. `project` is the app's
 * own pool key or its legacy credential. `owner_universal` is a universal key
 * of an organization owner (ADR 0031), never an admin's. `env` is the platform
 * key. Null when nothing is configured, including the platform env var.
 */
export type LlmKeySource = 'project' | 'organization' | 'owner_universal' | 'env';

const ENV_VAR: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  browserbase: 'BROWSERBASE_API_KEY',
  cursor: 'CURSOR_API_KEY',
};

/** Legacy project_settings column names (backward-compat fallback). */
const LEGACY_REF_COL = {
  anthropic: 'byok_anthropic_key_ref',
  openai: 'byok_openai_key_ref',
  firecrawl: 'byok_firecrawl_key_ref',
  browserbase: 'byok_browserbase_key_ref',
} as const satisfies Partial<Record<LlmProvider, string>>;

/** Providers with a single-key slot in project_settings (`byok_<provider>_*`). */
export type LegacyByokProvider = keyof typeof LEGACY_REF_COL;

/**
 * Every provider the legacy single-key routes (`/v1/admin/byok/:provider`)
 * manage. The console lists a legacy row for each one that has a stored ref,
 * so those routes must accept exactly this list.
 */
export const LEGACY_BYOK_PROVIDERS = Object.keys(LEGACY_REF_COL) as LegacyByokProvider[];

export function isLegacyByokProvider(value: string): value is LegacyByokProvider {
  return Object.prototype.hasOwnProperty.call(LEGACY_REF_COL, value);
}

const LEGACY_TEST_STATUS_COL: Partial<Record<LlmProvider, string>> = {
  anthropic: 'byok_anthropic_test_status',
  openai: 'byok_openai_test_status',
  firecrawl: 'byok_firecrawl_test_status',
  browserbase: 'byok_browserbase_test_status',
};

const LAST_USED_COL: Partial<Record<LlmProvider, string>> = {
  anthropic: 'byok_anthropic_key_last_used_at',
  openai: 'byok_openai_key_last_used_at',
  firecrawl: 'byok_firecrawl_key_last_used_at',
  browserbase: 'byok_browserbase_key_last_used_at',
};

/**
 * Resolve a single key (best-available). Maintains full back-compat with
 * single-key callers. Returns the highest-priority active key without
 * recording usage: selecting a credential is not a successful provider call.
 * Callers that perform provider I/O must invoke markKeyUsed only after a
 * successful response.
 */
export async function resolveLlmKey(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  opts: {
    /**
     * 'generation' (default): an LLM call follows, so the monthly budget is
     * enforced (throws LlmBudgetExceededError). 'probe' / 'embedding': a key
     * check or an embedding, which the budget does not cover.
     */
    purpose?: 'generation' | 'probe' | 'embedding';
    /** See resolveLlmKeys: true for calls only OpenAI itself serves (speech-to-text, fine-tuning). */
    openAiOnly?: boolean;
  } = {},
): Promise<ResolvedKey | null> {
  if ((opts.purpose ?? 'generation') === 'generation') {
    await enforceLlmBudget(db, projectId, provider);
  }
  const candidates = await resolveLlmKeys(db, projectId, provider, { openAiOnly: opts.openAiOnly });
  return candidates[0] ?? null;
}

/**
 * Enforce the project's monthly LLM budget before any provider call
 * (_shared/llm-budget.ts). Over budget throws LlmBudgetExceededError. A
 * failed budget read is logged to Sentry and the call proceeds: one failed
 * read must not stop triage, and it must not pass unnoticed either.
 */
export async function enforceLlmBudget(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<void> {
  if (!isBudgetedProvider(provider)) return;
  try {
    await assertLlmBudget(db, projectId);
  } catch (err) {
    if (err instanceof LlmBudgetUnavailableError) {
      log.error('LLM budget check failed; call proceeds unchecked', { projectId, provider, err: err.message });
      return;
    }
    throw err;
  }
}


/**
 * Resolve ALL active candidate keys for a provider, ordered by priority ASC.
 * Used by withLlmFailover() to iterate through keys on quota/auth failure.
 * Skips keys that are cooled down or in non-active states.
 *
 * For 'openai', the project's OpenRouter keys follow its OpenAI keys: they
 * serve the same OpenAI-compatible chat and embedding calls (callers qualify
 * model ids through _shared/openai-compat.ts). Pass `openAiOnly` for calls
 * OpenRouter cannot serve, such as speech-to-text and fine-tuning.
 */
export async function resolveLlmKeys(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  opts: { openAiOnly?: boolean } = {},
): Promise<ResolvedKey[]> {
  // The app's own keys always come first (ADR 0023): its pool keys (OpenAI,
  // then OpenRouter), else its legacy credential; then its organization's
  // shared keys; then the universal keys of its organization's owners (ADR
  // 0031); the platform key last.
  const owner = await projectKeyOwner(db, projectId);
  const pool = await byokPoolCandidates(db, owner, provider);
  const own = [...pool.own];
  const shared = [...pool.shared];
  const universal = [...pool.universal];
  if (provider === 'openai' && !opts.openAiOnly) {
    const router = await byokPoolCandidates(db, owner, 'openrouter');
    own.push(...router.own.map((c) => ({ ...c, provider: 'openrouter' as const })));
    shared.push(...router.shared.map((c) => ({ ...c, provider: 'openrouter' as const })));
    universal.push(...router.universal.map((c) => ({ ...c, provider: 'openrouter' as const })));
  }
  return orderCandidates({
    own,
    legacy: own.length > 0 ? [] : await legacyCandidates(db, projectId, provider),
    shared,
    universal,
    env: () => envCandidates(projectId, provider),
  });
}

/**
 * The five steps in order. The platform key is used only when the app has no
 * key at all: not its own, legacy, shared or universal.
 */
export function orderCandidates(c: {
  own: ResolvedKey[];
  legacy: ResolvedKey[];
  shared: ResolvedKey[];
  universal: ResolvedKey[];
  env: () => ResolvedKey[];
}): ResolvedKey[] {
  const out = [...(c.own.length > 0 ? c.own : c.legacy), ...c.shared, ...c.universal];
  return out.length > 0 ? out : c.env();
}

/**
 * The source `resolveLlmKeys` would pick first, without reading Vault,
 * reactivating a cooled-down key, enforcing the LLM budget, or logging that
 * the platform key is in use. Keyed only on the app (ADR 0023 / 0031).
 * Throws when a read fails. Null means nothing is configured, not that the
 * database could not be read.
 */
export async function resolveLlmKeySource(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  opts: { openAiOnly?: boolean } = {},
): Promise<LlmKeySource | null> {
  const [source] = await resolveLlmKeySources(db, projectId, [provider], opts);
  return source ?? null;
}

const EMPTY_SOURCE_FLAGS: PoolSourceFlags = {
  project: false,
  organization: false,
  universal: false,
};

/**
 * `resolveLlmKeySource` for several providers. One project-owner read and
 * one byok_keys read cover every provider (OpenRouter rides with OpenAI).
 * Legacy credentials share one project_settings read. Throws on a failed
 * read, same as `resolveLlmKeySource`.
 */
export async function resolveLlmKeySources(
  db: SupabaseClient,
  projectId: string,
  providers: readonly LlmProvider[],
  opts: { openAiOnly?: boolean } = {},
): Promise<Array<LlmKeySource | null>> {
  const owner = await projectKeyOwner(db, projectId, { strict: true });
  const readProviders = new Set<LlmProvider>(providers);
  if (readProviders.has('openai') && !opts.openAiOnly) readProviders.add('openrouter');
  const rows = readProviders.size > 0
    ? await readPoolRows(db, owner, [...readProviders], { strict: true })
    : [];
  const nowMs = Date.now();
  const flags = new Map<LlmProvider, PoolSourceFlags>();
  for (const provider of readProviders) flags.set(provider, { ...EMPTY_SOURCE_FLAGS });
  for (const row of rows) {
    const provider = row.provider_slug;
    const bucket = provider ? flags.get(provider) : undefined;
    if (!provider || !bucket) continue;
    const scope = sourceScopeForRow(row, owner, provider, nowMs);
    if (scope) bucket[scope] = true;
  }
  const merged = (provider: LlmProvider): PoolSourceFlags => {
    const own = flags.get(provider) ?? { ...EMPTY_SOURCE_FLAGS };
    if (provider === 'openai' && !opts.openAiOnly) {
      return mergeSourceFlags(own, flags.get('openrouter') ?? EMPTY_SOURCE_FLAGS);
    }
    return own;
  };
  const legacy = await legacySourcesAvailable(
    db,
    projectId,
    providers.filter((provider) => !merged(provider).project),
  );
  return providers.map((provider) => {
    const sourceFlags = merged(provider);
    if (sourceFlags.project) return 'project';
    if (legacy.get(provider)) return 'project';
    if (sourceFlags.organization) return 'organization';
    if (sourceFlags.universal) return 'owner_universal';
    if (Deno.env.get(ENV_VAR[provider])) return 'env';
    return null;
  });
}

/** One byok_keys row as the resolver reads it. */
interface PoolRow extends ByokPoolLifecycleState {
  id: string;
  provider_slug?: LlmProvider;
  project_id: string | null;
  organization_id?: string | null;
  owner_user_id?: string | null;
  vault_secret_id: string | null;
  label: string | null;
  priority: number | null;
  base_url: string | null;
}

interface PoolSourceFlags {
  project: boolean;
  organization: boolean;
  universal: boolean;
}

/**
 * byok_keys rows this app may use, app → organization → universal.
 * Includes `quota_exhausted` so a key that hit a 429 can re-enter once its
 * cooldown elapses. `auth_failed` and `disabled` stay out. Does not read
 * secrets or write status. A database without `owner_user_id` yet (functions
 * deployed before migration 20261021051628) is retried with no universal keys.
 */
async function readPoolRows(
  db: SupabaseClient,
  owner: KeyOwner,
  provider: LlmProvider | readonly LlmProvider[],
  opts: { strict?: boolean } = {},
): Promise<PoolRow[]> {
  const providers = typeof provider === 'string' ? [provider] : [...provider];
  const readPool = (o: KeyOwner, withUniversal: boolean) =>
    db
      .from('byok_keys')
      .select(
        `id, provider_slug, project_id, organization_id${withUniversal ? ', owner_user_id' : ''}, vault_secret_id, label, priority, status, cooldown_until, test_status, base_url`,
      )
      .or(keyOwnerFilter(o))
      .in('provider_slug', providers)
      .in('status', ['active', 'quota_exhausted'])
      .in('test_status', ['ok', 'error_quota'])
      .order('priority', { ascending: true });
  let { data: rawRows, error: poolError } = await readPool(owner, await ownerUserColumnReady(db));
  if (poolError && isMissingOwnerUserColumn(poolError)) {
    ({ data: rawRows, error: poolError } = await readPool({ ...owner, universalUserIds: [] }, false));
  }
  if (poolError) {
    log.warn('byok_keys read failed', {
      projectId: owner.projectId,
      provider: providers.join(','),
      error: poolError.message,
    });
    // The key resolver keeps going (the platform key may still serve the
    // call). The source probe must not report that failure as "no key".
    if (opts.strict) throw new Error(poolError.message);
    return [];
  }
  return rawRows ? ownKeysFirst(rawRows as unknown as PoolRow[]) : [];
}

/**
 * Normalized OpenAI-compatible base URL for a row that set one.
 * Null when the URL is unsafe (the row must not be used). An empty
 * `base_url` is not a custom URL; the caller uses the platform default.
 */
function openAiRowBaseUrl(row: PoolRow, projectId: string, warn = false): string | null {
  if (!row.base_url) return null;
  const validation = validateOpenAiBaseUrl(row.base_url, openAiCompatibleHostAllowlist());
  if (!validation.ok) {
    if (warn) {
      log.warn('Skipping BYOK key with unsafe OpenAI-compatible base URL', {
        projectId,
        keyId: row.id,
      });
    }
    return null;
  }
  return validation.value;
}

/**
 * A pool row the resolver would keep, before the secret is read.
 * The one pre-secret filter for both the source probe and
 * `byokPoolCandidates`: runnable state, a vault id, a scope this app may
 * use, and a safe OpenAI base URL. Cooldown is compared as epoch
 * milliseconds — Supabase timestamps vary in offset and precision, so a
 * lexical compare is unreliable. A malformed cooldown is non-runnable.
 */
function sourceScopeForRow(
  row: PoolRow,
  owner: KeyOwner,
  provider: LlmProvider,
  nowMs: number,
  warnUnsafeUrl = false,
): KeyScope | null {
  if (!isRunnableByokPoolState(row, nowMs)) return null;
  if (!row.vault_secret_id) return null;
  const scope = keyScopeFor(row, owner);
  if (!scope) return null;
  if (provider === 'openai' && row.base_url && !openAiRowBaseUrl(row, owner.projectId, warnUnsafeUrl)) return null;
  return scope;
}

function mergeSourceFlags(a: PoolSourceFlags, b: PoolSourceFlags): PoolSourceFlags {
  return {
    project: a.project || b.project,
    organization: a.organization || b.organization,
    universal: a.universal || b.universal,
  };
}

/**
 * Steps 1, 3 and 4: the byok_keys rows the project may use for one provider:
 * its own, its organization's shared keys (ADR 0023) and its organization
 * owners' universal keys (ADR 0031), each group by priority.
 */
async function byokPoolCandidates(
  db: SupabaseClient,
  owner: KeyOwner,
  provider: LlmProvider,
): Promise<{ own: ResolvedKey[]; shared: ResolvedKey[]; universal: ResolvedKey[] }> {
  const nowMs = Date.now();
  const projectId = owner.projectId;
  const keyRows = await readPoolRows(db, owner, provider);

  const own: ResolvedKey[] = [];
  const shared: ResolvedKey[] = [];
  const universal: ResolvedKey[] = [];

  if (keyRows && keyRows.length > 0) {
    for (const row of keyRows) {
      // Cross-tenant guard included: sourceScopeForRow drops a row this
      // project may not use even if the query returned it (a universal key
      // whose owner does not own this project's organization never serves it).
      const scope = sourceScopeForRow(row, owner, provider, nowMs, true);
      if (!scope) continue;

      const ref = `vault://${row.vault_secret_id}`;
      const dereffed = await dereferenceKey(db, ref);
      if (dereffed) {
        // A previously quota_exhausted key whose cooldown has elapsed is
        // viable again — flip it back to 'active' so the health view and
        // future queries reflect reality. Best-effort; never blocks the call.
        if (row.status === 'quota_exhausted') {
          void reactivateKey(db, row.id);
        }
        let baseUrl: string | undefined;
        if (provider === 'openai') {
          // The filter above already dropped an unsafe custom URL.
          baseUrl = row.base_url
            ? (openAiRowBaseUrl(row, projectId) ?? undefined)
            : validatedPlatformOpenAiBaseUrl(projectId);
        } else if (provider === 'openrouter') {
          baseUrl = OPENROUTER_BASE_URL;
        }
        (scope === 'project' ? own : scope === 'organization' ? shared : universal).push({
          keyId: row.id,
          key: dereffed,
          source: 'byok',
          hint: hint(dereffed),
          baseUrl,
          label: row.label ?? undefined,
          scope,
          ...(scope === 'project' ? {} : { shared: true }),
        });
      }
    }
  }

  return { own, shared, universal };
}

/** Steps 2 and 3: the legacy single-key column, then the platform key. */
/** Step 2: the project's legacy project_settings credential, if it passed validation. */
async function legacyCandidates(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey[]> {
  // Step 2: Legacy project_settings columns (back-compat).
  const refCol = isLegacyByokProvider(provider) ? LEGACY_REF_COL[provider] : undefined;
  if (refCol) {
    const testStatusCol = LEGACY_TEST_STATUS_COL[provider];
    const selectCols = [
      refCol,
      testStatusCol,
      provider === 'openai' ? 'byok_openai_base_url' : null,
    ]
      .filter(Boolean)
      .join(', ');
    const { data: settings, error } = await db
      .from('project_settings')
      .select(selectCols)
      .eq('project_id', projectId)
      .single();

    if (error)
      log.warn('Failed to read project_settings for BYOK', {
        projectId,
        provider,
        error: error.message,
      });

    const row = settings as Record<string, string | null> | null;
    const ref = row?.[refCol];
    const testStatus = testStatusCol ? row?.[testStatusCol] : null;
    let baseUrl =
      provider === 'openai'
        ? (row?.byok_openai_base_url ?? validatedPlatformOpenAiBaseUrl(projectId))
        : undefined;

    if (ref && testStatus === 'ok') {
      if (provider === 'openai' && row?.byok_openai_base_url) {
        const validation = validateOpenAiBaseUrl(
          row.byok_openai_base_url,
          openAiCompatibleHostAllowlist(),
        );
        if (!validation.ok) {
          log.warn('Skipping legacy BYOK key with unsafe OpenAI-compatible base URL', {
            projectId,
          });
          baseUrl = undefined;
        } else {
          baseUrl = validation.value;
        }
      }
      const dereffed = await dereferenceKey(db, ref);
      if (dereffed && (provider !== 'openai' || !row?.byok_openai_base_url || baseUrl)) {
        return [{ key: dereffed, source: 'byok', hint: hint(dereffed), baseUrl }];
      }
      log.warn('BYOK legacy ref present but dereference failed; falling back to env', {
        projectId,
        provider,
      });
    } else if (ref) {
      log.warn('Skipping legacy BYOK key that has not passed validation', { projectId, provider });
    }
  }
  return [];
}

/** Columns the legacy predicate reads for these providers. */
function legacySelectCols(providers: readonly LlmProvider[]): string[] {
  const cols: string[] = [];
  for (const provider of providers) {
    if (!isLegacyByokProvider(provider)) continue;
    cols.push(LEGACY_REF_COL[provider]);
    const status = LEGACY_TEST_STATUS_COL[provider];
    if (status) cols.push(status);
    if (provider === 'openai') cols.push('byok_openai_base_url');
  }
  return [...new Set(cols)];
}

/**
 * True when the legacy credential would be a candidate: a stored ref that
 * passed validation, and a safe OpenAI base URL when one is set. Does not
 * read the secret. A failed Vault read still falls through inside
 * `legacyCandidates`; this check only mirrors the row predicate.
 */
function legacyRowAvailable(
  provider: LlmProvider,
  row: Record<string, string | null> | null,
): boolean {
  const refCol = isLegacyByokProvider(provider) ? LEGACY_REF_COL[provider] : undefined;
  if (!refCol || !row) return false;
  const testStatusCol = LEGACY_TEST_STATUS_COL[provider];
  const ref = row[refCol];
  const testStatus = testStatusCol ? row[testStatusCol] : null;
  if (!ref || testStatus !== 'ok') return false;
  if (provider === 'openai' && row.byok_openai_base_url) {
    return validateOpenAiBaseUrl(row.byok_openai_base_url, openAiCompatibleHostAllowlist()).ok;
  }
  return true;
}

/**
 * One project_settings read for every provider that still needs its legacy
 * credential. A failed read throws: absence of a row is "no legacy key",
 * a database error is not.
 */
async function legacySourcesAvailable(
  db: SupabaseClient,
  projectId: string,
  providers: readonly LlmProvider[],
): Promise<Map<LlmProvider, boolean>> {
  const out = new Map<LlmProvider, boolean>();
  const cols = legacySelectCols(providers);
  if (cols.length === 0) return out;
  const { data: settings, error } = await db
    .from('project_settings')
    .select(cols.join(', '))
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (settings as Record<string, string | null> | null) ?? null;
  for (const provider of providers) out.set(provider, legacyRowAvailable(provider, row));
  return out;
}

/** Step 3: the platform env-var key, when the project has no key of its own or shared. */
function envCandidates(projectId: string, provider: LlmProvider): ResolvedKey[] {
  const env = Deno.env.get(ENV_VAR[provider]);
  if (env) {
    log.warn('BYOK call using platform env key — BYOK not configured for this project', {
      projectId,
      provider,
      hint: hint(env),
    });
    const baseUrl = provider === 'openai'
      ? validatedPlatformOpenAiBaseUrl(projectId)
      : provider === 'openrouter' ? OPENROUTER_BASE_URL : undefined;
    return [{ key: env, source: 'env', hint: hint(env), baseUrl }];
  }

  return [];
}

// Same date shape as QUOTA_RESET_RE in llm-failover.ts. A monthly cap names
// when access returns; a plain 429 does not.
const QUOTA_RESET_RE =
  /(?:access resumes|regain access(?: on)?)\s+(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\s*UTC)?)/i;

/** UTC millis for a provider reset stamp, or null when it is not a date. */
function parseQuotaResetMs(raw: string): number | null {
  let s = raw.replace(/\s*UTC$/i, '').trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (/T\d{2}:\d{2}$/.test(s)) s += ':00Z';
  else if (/T\d{2}:\d{2}:\d{2}$/.test(s)) s += 'Z';
  else return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Quota hold length. A 429 cools for one hour. A monthly cap that names a
 * future reset cools until that instant, so the key is not probed every hour
 * until the provider opens again. A reset already in the past keeps the hour.
 */
function quotaCooldownUntil(reason: string, now = Date.now()): string {
  const raw = reason.match(QUOTA_RESET_RE)?.[1]?.replace(/\s+/g, ' ')?.trim();
  const resetMs = raw ? parseQuotaResetMs(raw) : null;
  const until = resetMs !== null && resetMs > now ? resetMs : now + 60 * 60 * 1000;
  return new Date(until).toISOString();
}

/**
 * Mark a byok_keys row with a new status (called by withLlmFailover on error).
 * Quota exhaustion sets a cooldown so the key is tried again later: one hour
 * for a 429, or until the reset date when the provider named one.
 */
export async function markKeyStatus(
  db: SupabaseClient,
  keyId: string,
  status: Extract<KeyStatus, 'quota_exhausted' | 'auth_failed'>,
  reason: string,
): Promise<void> {
  const cooldownUntil = status === 'quota_exhausted' ? quotaCooldownUntil(reason) : null;

  // PostgREST query builders are thenables (`then` only) — they have no
  // `.catch`, and they resolve with `{ error }` rather than rejecting. Await
  // and inspect `error` instead of chaining `.catch`, which would throw a
  // TypeError and (because this runs inside withLlmFailover's catch block)
  // abort the whole failover loop on the first 429/401.
  const { error } = await db
    .from('byok_keys')
    .update({
      status,
      test_status: status === 'quota_exhausted' ? 'error_quota' : 'error_auth',
      last_tested_at: new Date().toISOString(),
      last_error: reason.slice(0, 500),
      cooldown_until: cooldownUntil,
    })
    .eq('id', keyId);
  if (error) {
    log.warn('markKeyStatus failed (non-fatal)', { keyId, status, error: error.message });
  }
}

/** Best-effort usage bookkeeping for the credential actually selected. */
export async function markKeyUsed(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  keyId?: string,
): Promise<void> {
  const usedAt = new Date().toISOString();
  if (keyId) {
    const { error } = await db
      .from('byok_keys')
      .update({ last_used_at: usedAt })
      .eq('id', keyId)
      // The key may be the organization's shared key (ADR 0023) or a
      // universal key of its owner (ADR 0031).
      .or(keyOwnerFilter(await projectKeyOwner(db, projectId)));
    if (error) {
      log.warn('Failed to update pooled BYOK last-used timestamp', {
        projectId,
        provider,
        keyId,
        error: error.message,
      });
    }
  } else {
    const lastUsedCol = LAST_USED_COL[provider];
    if (lastUsedCol) {
      const { error } = await db
        .from('project_settings')
        .update({ [lastUsedCol]: usedAt })
        .eq('project_id', projectId);
      if (error) {
        log.warn('Failed to update legacy BYOK last-used timestamp', {
          projectId,
          provider,
          error: error.message,
        });
      }
    }
  }

  const { error: auditError } = await db.from('byok_audit_log').insert({
    project_id: projectId,
    provider,
    action: 'used',
    ...(keyId ? { meta: { key_id: keyId } } : {}),
  });
  if (auditError) {
    log.warn('Failed to record BYOK usage audit event', {
      projectId,
      provider,
      keyId,
      error: auditError.message,
    });
  }
}

/**
 * Best-effort: clear quota_exhausted state on a key whose cooldown elapsed.
 * Never throws — a failed reset just leaves the (now-usable) key flagged.
 */
async function reactivateKey(db: SupabaseClient, keyId: string): Promise<void> {
  const { error } = await db
    .from('byok_keys')
    .update({
      status: 'active',
      test_status: 'ok',
      last_tested_at: new Date().toISOString(),
      last_error: null,
      cooldown_until: null,
    })
    .eq('id', keyId);
  if (error) log.warn('reactivateKey failed (non-fatal)', { keyId, error: error.message });
}

async function dereferenceKey(db: SupabaseClient, ref: string): Promise<string | null> {
  if (!ref.startsWith('vault://')) {
    const env = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('NODE_ENV') ?? '';
    const isProd = env === 'production' || env === 'prod';

    if (isProd) {
      log.error('BYOK raw key rejected in production environment — use vault://<id>', {});
      return null;
    }

    if (!warnedRaw) {
      warnedRaw = true;
      log.warn(
        'BYOK is using raw key in DB; this is only allowed in dev/staging. Switch to vault://<id> for production.',
        {},
      );
    }
    return ref;
  }
  const id = ref.slice('vault://'.length);
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id });
  if (error) {
    log.warn('vault_get_secret rpc failed', { error: error.message });
    return null;
  }
  return typeof data === 'string' ? data : null;
}

let warnedRaw = false;

function hint(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '****';
}

function openAiCompatibleHostAllowlist(): string[] {
  return (Deno.env.get('MUSHI_OPENAI_BASE_URL_ALLOWLIST') ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

function validatedPlatformOpenAiBaseUrl(projectId: string): string | undefined {
  const configured = Deno.env.get('OPENAI_BASE_URL');
  if (!configured) return undefined;

  const validation = validateOpenAiBaseUrl(configured, openAiCompatibleHostAllowlist());
  if (validation.ok) return validation.value;

  log.error('Ignoring unsafe OPENAI_BASE_URL platform configuration', {
    projectId,
    reason: validation.message,
  });
  return undefined;
}
