export type PoolKeyStatus =
  | 'pending_validation'
  | 'active'
  | 'disabled'
  | 'quota_exhausted'
  | 'auth_failed';

export type PoolTestStatus = 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null;

export type PoolProvider = 'anthropic' | 'openai' | 'cursor' | 'firecrawl' | 'browserbase';

export interface PoolKey {
  id: string;
  provider_slug: PoolProvider;
  label: string | null;
  priority: number;
  status: PoolKeyStatus;
  key_hint: string | null;
  base_url: string | null;
  test_status: PoolTestStatus;
  last_tested_at: string | null;
  last_used_at: string | null;
  cooldown_until: string | null;
  created_at: string;
}

export function isRuntimeEligiblePoolKey(key: PoolKey, nowMs = Date.now()): boolean {
  if (key.status !== 'active' && key.status !== 'quota_exhausted') return false;
  if (key.test_status !== 'ok' && key.test_status !== 'error_quota') return false;

  // Keep Settings' "connected"/primary-key decision identical to the Edge
  // runtime. A quota-exhausted key is eligible only after its cooldown; an
  // invalid timestamp fails closed instead of presenting a key the resolver
  // will skip.
  return !key.cooldown_until || new Date(key.cooldown_until).getTime() <= nowMs;
}

export function providerPoolKeys(keys: PoolKey[], provider: PoolProvider): PoolKey[] {
  return keys
    .filter((key) => key.provider_slug === provider)
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
}

/**
 * Match runtime selection for the provider whenever a runnable key exists.
 * If every key is quarantined, return the highest-priority row so Settings can
 * explain and repair the provider failure instead of claiming it is absent.
 */
export function selectPrimaryProviderKey(keys: PoolKey[], provider: PoolProvider): PoolKey | null {
  const providerKeys = providerPoolKeys(keys, provider);
  const nowMs = Date.now();
  // Do not pass the helper directly: Array#find supplies its index as the
  // callback's second argument, which would replace the helper's timestamp.
  return (
    providerKeys.find((key) => isRuntimeEligiblePoolKey(key, nowMs)) ?? providerKeys[0] ?? null
  );
}
