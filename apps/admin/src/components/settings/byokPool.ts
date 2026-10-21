export type PoolKeyStatus =
  | 'pending_validation'
  | 'active'
  | 'disabled'
  | 'quota_exhausted'
  | 'auth_failed';

export type PoolTestStatus = 'ok' | 'error_auth' | 'error_network' | 'error_quota' | null;

export type PoolProvider = 'anthropic' | 'openai' | 'cursor' | 'firecrawl' | 'browserbase' | 'supabase';

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
  /** Owner-entered date the key stops working; null when unknown. */
  expires_at?: string | null;
  /**
   * 'project' = this app only; 'organization' = every app in the
   * organization (ADR 0023); 'universal' = every app in every organization
   * its owner owns (ADR 0031).
   */
  scope?: KeyScope;
  /** Universal keys: the signed-in user added it, so they may change it. */
  ownedByMe?: boolean;
  /** The signed-in user added this key; only then can it become "All my apps" (ADR 0031). */
  addedByMe?: boolean;
  /** Universal keys: Mushi uses it for this app (its owner owns this app's organization). */
  servesThisApp?: boolean;
}

export type KeyScope = 'project' | 'organization' | 'universal';

/** Whether this app can share keys with the rest of its organization. */
export interface KeySharing {
  organizationName: string;
  appCount: number;
  /** Owners and admins add, move and change shared keys. */
  canManage: boolean;
}

/** Whether the signed-in user may add "All my apps" keys here, and how far they reach (ADR 0031). */
export interface KeyUniversal {
  /** They own this app's organization, so a universal key added here serves it. */
  canAdd: boolean;
  /** Apps across every organization they own. */
  appCount: number;
  organizationCount: number;
}

/** Used by more apps than this one: an organization key or a universal key. */
export function isSharedKey(key: { scope?: string } | null | undefined): boolean {
  return key?.scope === 'organization' || key?.scope === 'universal';
}

export function isUniversalKey(key: { scope?: string } | null | undefined): boolean {
  return key?.scope === 'universal';
}

/**
 * The scope the add form starts on (ADR 0031): "All my apps" whenever the
 * user may add one, then "This organization" for owners and admins, else
 * this app. Supabase tokens are never shared.
 */
export function defaultAddScope(
  provider: string,
  universal: KeyUniversal | null | undefined,
  sharing: KeySharing | null | undefined,
): KeyScope {
  if (provider === 'supabase') return 'project';
  if (universal?.canAdd) return 'universal';
  if (sharing?.canManage) return 'organization';
  return 'project';
}

/** "all 12 apps in your 2 organizations", or "every app you own" when there is just one. */
export function myAppsPhrase(universal: KeyUniversal | null | undefined): string {
  if (!universal || universal.appCount <= 1) return 'every app you own, including ones you add later';
  const orgs = universal.organizationCount > 1 ? ` in your ${universal.organizationCount} organizations` : '';
  return `all ${universal.appCount} apps you own${orgs}`;
}

/** The chip on a key row, in plain words. */
export function scopeChipLabel(
  key: Pick<PoolKey, 'scope' | 'ownedByMe'>,
  sharing: KeySharing | null | undefined,
): string {
  if (key.scope === 'universal') return key.ownedByMe ? 'All my apps' : "Owner's key, all their apps";
  if (key.scope === 'organization') return `All apps${sharing ? ` in ${sharing.organizationName}` : ''}`;
  return 'This app only';
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
