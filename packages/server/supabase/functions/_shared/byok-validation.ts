import { z } from 'npm:zod@3';

export const BYOK_PROVIDERS = [
  'anthropic',
  'openai',
  'firecrawl',
  'browserbase',
  'cursor',
] as const;

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
  .strict();

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

function probeRequest(
  provider: ByokProvider,
  apiKey: string,
  baseUrl?: string,
): { url: string; init: RequestInit } {
  switch (provider) {
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
      return {
        url: 'https://api.firecrawl.dev/v1/search',
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: 'mushi mushi sdk', limit: 1 }),
        },
      };
    case 'browserbase':
      return {
        url: 'https://api.browserbase.com/v1/sessions',
        init: { headers: { 'X-BB-API-Key': apiKey } },
      };
  }
}

function mapProbeStatus(status: number): Pick<ByokProbeResult, 'status' | 'keyStatus' | 'detail'> {
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
): Promise<ByokProbeResult> {
  const startedAt = Date.now();
  const request = probeRequest(provider, apiKey, baseUrl);

  try {
    const response = await fetcher(request.url, {
      ...request.init,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    return {
      ...mapProbeStatus(response.status),
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
