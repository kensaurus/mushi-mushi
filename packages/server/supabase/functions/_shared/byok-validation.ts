import { z } from 'npm:zod@3';
import { isLocalOnly, localHostReason, parseHost } from './egress.ts';
import { isSupabaseProjectRef } from './supabase-project-ref.ts';

export const BYOK_PROVIDERS = [
  'anthropic',
  'openai',
  // OpenRouter keys (sk-or-…). They also serve OpenAI-compatible calls after
  // the project's OpenAI keys (_shared/byok.ts).
  'openrouter',
  'firecrawl',
  'browserbase',
  'cursor',
  // A Supabase personal access token for the project's linked Supabase
  // project (`project_settings.supabase_project_ref`). Read-only features
  // only; ask for a scoped token (ADR 0016).
  'supabase',
] as const;

/** Every Supabase personal access token, classic or scoped, starts with this. */
export const SUPABASE_PAT_PREFIX = 'sbp_';

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];
export type ByokProbeStatus = 'ok' | 'error_auth' | 'error_network' | 'error_quota';
export type ByokKeyStatus =
  | 'pending_validation'
  | 'active'
  | 'disabled'
  | 'quota_exhausted'
  | 'auth_failed';

export interface ByokPoolLifecycleState {
  status: ByokKeyStatus;
  test_status: ByokProbeStatus | null;
  cooldown_until?: string | null;
}

export function isRunnableByokPoolState(row: ByokPoolLifecycleState, nowMs = Date.now()): boolean {
  if (row.status !== 'active' && row.status !== 'quota_exhausted') return false;
  if (row.test_status !== 'ok' && row.test_status !== 'error_quota') return false;
  return !row.cooldown_until || new Date(row.cooldown_until).getTime() <= nowMs;
}

export interface ByokProbeResult {
  status: ByokProbeStatus;
  keyStatus: Exclude<ByokKeyStatus, 'disabled'>;
  detail: string;
  httpStatus: number;
  latencyMs: number;
}

export const createByokKeySchema = z
  .object({
    projectId: z.string().uuid(),
    provider: z.enum(BYOK_PROVIDERS),
    apiKey: z.string().trim().min(8).max(4096),
    label: z.string().trim().min(1).max(100).nullable().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    baseUrl: z.string().trim().max(2048).optional(),
  })
  .strict()
  .refine((body) => body.provider !== 'supabase' || body.apiKey.startsWith(SUPABASE_PAT_PREFIX), {
    message: `A Supabase access token starts with "${SUPABASE_PAT_PREFIX}". Create one at supabase.com/dashboard/account/tokens.`,
    path: ['apiKey'],
  });

export const patchByokKeySchema = z
  .object({
    projectId: z.string().uuid(),
    label: z.string().trim().min(1).max(100).nullable().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()
  .refine(
    (body) => body.label !== undefined || body.priority !== undefined || body.status !== undefined,
    {
      message: 'At least one mutable field is required',
    },
  );

export const byokProjectSchema = z
  .object({
    projectId: z.string().uuid(),
  })
  .strict();

export const byokKeyIdSchema = z.string().uuid();

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
/** The Anthropic API root. The SDK appends `/v1/messages`; the AI SDK wants `<root>/v1`. */
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_OPENAI_COMPATIBLE_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.groq.com',
  'api.deepseek.com',
]);
const DEFAULT_ANTHROPIC_HOSTS = new Set(['api.anthropic.com']);

function isAllowedHost(hostname: string, defaults: Set<string>, extraAllowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  if (defaults.has(host)) return true;
  return extraAllowedHosts.some((allowed) => host === allowed.trim().toLowerCase());
}

/**
 * A model server on this machine or this network: loopback, RFC 1918, CGNAT,
 * unique-local IPv6, `localhost`, `*.internal` / `*.local` / `*.lan`, or a
 * single-label name such as a compose service (`ollama`). Link-local
 * addresses and cloud metadata names are never one: they are where SSRF goes.
 */
export function isPrivateLlmHost(hostname: string): boolean {
  const host = parseHost(hostname);
  if (host.kind === 'name') {
    if (host.text === 'metadata' || host.text === 'metadata.google.internal') return false;
    if (host.text && !host.text.includes('.')) return true;
  }
  const reason = localHostReason(host);
  return reason !== null && reason !== 'link-local';
}

function envFlag(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno;
  try {
    return deno?.env?.get(name);
  } catch {
    return undefined;
  }
}

/**
 * Local model servers are allowed as base URLs (http, any port, private
 * hosts) only in local-only mode or with MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT=1.
 * On Mushi Cloud neither is set, so a tenant cannot point Mushi's server at
 * an address inside its network.
 */
export function privateLlmEndpointsAllowed(env: (name: string) => string | undefined = envFlag): boolean {
  return (
    isLocalOnly({ MUSHI_LOCAL_ONLY: env('MUSHI_LOCAL_ONLY') }) ||
    /^(1|true|yes|on)$/i.test((env('MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT') ?? '').trim())
  );
}

export interface BaseUrlRules {
  /** Accept http and any port for private hosts. Defaults to privateLlmEndpointsAllowed(). */
  allowPrivate?: boolean;
}

type BaseUrlResult = { ok: true; value: string } | { ok: false; message: string };

function validateLlmBaseUrl(
  candidate: string,
  defaults: Set<string>,
  extraAllowedHosts: readonly string[],
  rules: BaseUrlRules,
  label: string,
): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: 'baseUrl must be a valid HTTPS URL' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'baseUrl must not contain credentials' };
  }
  if (url.hash || url.search) {
    return {
      ok: false,
      message: 'baseUrl must not contain a query string or fragment',
    };
  }
  const allowPrivate = rules.allowPrivate ?? privateLlmEndpointsAllowed();
  if (allowPrivate && (url.protocol === 'http:' || url.protocol === 'https:') && isPrivateLlmHost(url.hostname)) {
    // A local model server (Ollama, vLLM, LM Studio): plain http on its own port is normal.
    return { ok: true, url };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: 'baseUrl must use https://' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, message: 'baseUrl must use the default HTTPS port' };
  }
  if (!isAllowedHost(url.hostname, defaults, extraAllowedHosts)) {
    return {
      ok: false,
      message: `baseUrl host is not an approved ${label} provider`,
    };
  }
  return { ok: true, url };
}

export function validateOpenAiBaseUrl(
  raw: string | undefined,
  extraAllowedHosts: readonly string[] = [],
  rules: BaseUrlRules = {},
): BaseUrlResult {
  const candidate = raw?.trim() || DEFAULT_OPENAI_BASE_URL;
  const checked = validateLlmBaseUrl(candidate, DEFAULT_OPENAI_COMPATIBLE_HOSTS, extraAllowedHosts, rules, 'OpenAI-compatible');
  if (!checked.ok) return checked;
  return { ok: true, value: checked.url.toString().replace(/\/$/, '') };
}

/**
 * An Anthropic-compatible API root (api.anthropic.com, Ollama's Messages API,
 * a gateway on MUSHI_ANTHROPIC_BASE_URL_ALLOWLIST). Returned without a
 * trailing slash or `/v1`, the form the Anthropic SDK and ANTHROPIC_BASE_URL use.
 */
export function validateAnthropicBaseUrl(
  raw: string | undefined,
  extraAllowedHosts: readonly string[] = [],
  rules: BaseUrlRules = {},
): BaseUrlResult {
  const candidate = raw?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
  const checked = validateLlmBaseUrl(candidate, DEFAULT_ANTHROPIC_HOSTS, extraAllowedHosts, rules, 'Anthropic-compatible');
  if (!checked.ok) return checked;
  const value = checked.url.toString().replace(/\/+$/, '').replace(/\/v1$/, '');
  return { ok: true, value };
}

export interface ByokProbeOptions {
  /**
   * The project's `supabase_project_ref`. A Supabase token is checked against
   * that one project, so without a valid ref the probe makes no request.
   */
  supabaseProjectRef?: string | null;
}

function probeRequest(
  provider: ByokProvider,
  apiKey: string,
  baseUrl?: string,
  options: ByokProbeOptions = {},
): { url: string; init: RequestInit } {
  switch (provider) {
    case 'supabase':
      // Management API read-only query: runs as Supabase's read-only Postgres
      // role and needs exactly the Database Read permission the link uses.
      // The ref is validated by the caller (probeByokKey) before it reaches
      // the path.
      return {
        url: `https://api.supabase.com/v1/projects/${options.supabaseProjectRef}/database/query/read-only`,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'mushi-mushi-byok-probe/1.0',
          },
          body: JSON.stringify({ query: 'select 1' }),
        },
      };
    case 'anthropic':
      return {
        url: `${baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL}/v1/models`,
        init: {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        },
      };
    case 'openai':
      return {
        url: `${baseUrl ?? DEFAULT_OPENAI_BASE_URL}/models`,
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case 'openrouter':
      // Free: describes the key (limit, usage) without spending credits.
      return {
        url: 'https://openrouter.ai/api/v1/key',
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case 'cursor':
      return {
        url: 'https://api.cursor.com/v1/me',
        init: {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'mushi-mushi-byok-probe/1.0',
          },
        },
      };
    case 'firecrawl':
      // Free: reads the team's remaining credits. A search here cost a credit
      // on every "Test key" click.
      return {
        url: 'https://api.firecrawl.dev/v2/team/credit-usage',
        init: { headers: { Authorization: `Bearer ${apiKey}` } },
      };
    case 'browserbase':
      return {
        url: 'https://api.browserbase.com/v1/sessions',
        init: { headers: { 'X-BB-API-Key': apiKey } },
      };
  }
}

const SUPABASE_PROBE_DETAIL: Record<number, string> = {
  401: 'Supabase rejected the token. It was revoked, expired or mistyped.',
  403: 'The token cannot read this project. Scope it to this project with Database Read (plus Edge Functions, Advisors and Logs Read).',
  404: 'Supabase has no project with this ref, or the token cannot see it. Check the project ref in Settings → General.',
};

function mapProbeStatus(
  status: number,
  provider?: ByokProvider,
): Pick<ByokProbeResult, 'status' | 'keyStatus' | 'detail'> {
  const mapped = mapGenericProbeStatus(status);
  const supabaseDetail = provider === 'supabase' ? SUPABASE_PROBE_DETAIL[status] : undefined;
  return supabaseDetail ? { ...mapped, detail: supabaseDetail } : mapped;
}

function mapGenericProbeStatus(
  status: number,
): Pick<ByokProbeResult, 'status' | 'keyStatus' | 'detail'> {
  if (status >= 200 && status < 300) {
    return {
      status: 'ok',
      keyStatus: 'active',
      detail: `Credential validated (HTTP ${status})`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 'error_auth',
      keyStatus: 'auth_failed',
      detail: 'Provider rejected the credential',
    };
  }
  if (status === 429) {
    return {
      status: 'error_quota',
      keyStatus: 'quota_exhausted',
      detail: 'Provider accepted the request but the account is rate-limited or out of quota',
    };
  }
  return {
    status: 'error_network',
    keyStatus: 'pending_validation',
    detail: `Provider validation endpoint returned HTTP ${status}`,
  };
}

/**
 * A local model server (Ollama, vLLM) often has no models list on the path
 * the probe reads, and checks no key. Any answer that is not an auth,
 * quota or server error means it is up, which is all a probe can learn.
 */
function localServerAnswered(
  provider: ByokProvider,
  baseUrl: string | undefined,
  status: number,
): Pick<ByokProbeResult, 'status' | 'keyStatus' | 'detail'> | null {
  if (provider !== 'anthropic' && provider !== 'openai') return null;
  if (!baseUrl || status === 401 || status === 403 || status === 429 || status >= 500) return null;
  if (status >= 200 && status < 300) return null;
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return null;
  }
  if (!isPrivateLlmHost(host)) return null;
  return {
    status: 'ok',
    keyStatus: 'active',
    detail: `Local endpoint answered (HTTP ${status}); local servers do not check keys`,
  };
}

export async function probeByokKey(
  provider: ByokProvider,
  apiKey: string,
  baseUrl?: string,
  fetcher: typeof fetch = fetch,
  options: ByokProbeOptions = {},
): Promise<ByokProbeResult> {
  const startedAt = Date.now();
  if (provider === 'supabase' && !isSupabaseProjectRef(options.supabaseProjectRef)) {
    // Nothing to check the token against yet. Keep it quarantined and say
    // what unblocks it, without a network call.
    return {
      status: 'error_network',
      keyStatus: 'pending_validation',
      detail:
        'Link the Supabase project first: set its project ref in Settings → General, then test this token again.',
      httpStatus: 0,
      latencyMs: 0,
    };
  }
  const request = probeRequest(provider, apiKey, baseUrl, options);

  try {
    const response = await fetcher(request.url, {
      ...request.init,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    return {
      ...(localServerAnswered(provider, baseUrl, response.status) ?? mapProbeStatus(response.status, provider)),
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      status: 'error_network',
      keyStatus: 'pending_validation',
      detail: 'Provider validation request could not be completed',
      httpStatus: 0,
      latencyMs: Date.now() - startedAt,
    };
  }
}
