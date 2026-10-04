import { z } from 'npm:zod@3';
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
const DEFAULT_OPENAI_COMPATIBLE_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.groq.com',
  'api.deepseek.com',
]);

function isAllowedCompatibleHost(hostname: string, extraAllowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  if (DEFAULT_OPENAI_COMPATIBLE_HOSTS.has(host)) return true;
  return extraAllowedHosts.some((allowed) => host === allowed.trim().toLowerCase());
}

export function validateOpenAiBaseUrl(
  raw: string | undefined,
  extraAllowedHosts: readonly string[] = [],
): { ok: true; value: string } | { ok: false; message: string } {
  const candidate = raw?.trim() || DEFAULT_OPENAI_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: 'baseUrl must be a valid HTTPS URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, message: 'baseUrl must use https://' };
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
  if (url.port && url.port !== '443') {
    return { ok: false, message: 'baseUrl must use the default HTTPS port' };
  }
  if (!isAllowedCompatibleHost(url.hostname, extraAllowedHosts)) {
    return {
      ok: false,
      message: 'baseUrl host is not an approved OpenAI-compatible provider',
    };
  }

  return { ok: true, value: url.toString().replace(/\/$/, '') };
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
        url: 'https://api.anthropic.com/v1/models',
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
      ...mapProbeStatus(response.status, provider),
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
