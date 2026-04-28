import type {
  MushiApiClient,
  MushiApiResponse,
  MushiReport,
  MushiReportStatus,
  MushiReporterComment,
  MushiReporterReport,
  MushiRuntimeSdkConfig,
  MushiSdkVersionInfo,
} from './types';

export interface ApiClientOptions {
  projectId: string;
  apiKey: string;
  /**
   * Override the API endpoint. Defaults to the canonical Cloud URL
   * (DEFAULT_API_ENDPOINT). Self-hosted users MUST set this.
   */
  apiEndpoint?: string;
  timeout?: number;
  maxRetries?: number;
}

// V5.3 (M-cross-cutting): canonical Cloud URL — the older `api.mushimushi.dev`
// hostname was never wired up. Self-hosted users MUST override `apiEndpoint`.
export const DEFAULT_API_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api';
export const MUSHI_INTERNAL_HEADER = 'X-Mushi-Internal';
export const MUSHI_INTERNAL_INIT_MARKER = '__mushiInternal';

export type MushiInternalRequestKind = 'sdk-config' | 'report-submit' | 'report-status' | 'reporter-poll' | 'diagnose';

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 2;

export function createApiClient(options: ApiClientOptions): MushiApiClient {
  const {
    projectId,
    apiKey,
    apiEndpoint = DEFAULT_API_ENDPOINT,
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  let baseUrl = apiEndpoint.replace(/\/$/, '');

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = maxRetries,
    internalKind?: MushiInternalRequestKind,
  ): Promise<MushiApiResponse<T>> {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': apiKey,
          'X-Mushi-Project': projectId,
          ...(internalKind ? { [MUSHI_INTERNAL_HEADER]: internalKind } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        ...(internalKind ? { [MUSHI_INTERNAL_INIT_MARKER]: internalKind } : {}),
      } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: MushiInternalRequestKind });

      clearTimeout(timer);

      // C7: data residency — follow a one-shot redirect when the
      // gateway tells us the project lives in a different region. Cache the
      // new base URL so subsequent calls go straight to the right cluster.
      if (response.status === 307 || response.status === 308) {
        const target = response.headers.get('Location');
        if (target && retries > 0) {
          const targetBase = target.replace(/\/v1\/.*$/, '').replace(/\/$/, '');
          if (targetBase !== baseUrl) {
            baseUrl = targetBase;
            return request<T>(method, path, body, retries - 1, internalKind);
          }
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        if (response.status >= 500 && retries > 0) {
          await sleep(getBackoffDelay(maxRetries - retries));
          return request<T>(method, path, body, retries - 1, internalKind);
        }
        return {
          ok: false,
          error: {
            code: `HTTP_${response.status}`,
            message:
              (errorBody as { message?: string; error?: { message?: string } }).error?.message ||
              (errorBody as { message?: string }).message ||
              `HTTP ${response.status} error`,
          },
        };
      }

      const payload = await response.json();
      const data = payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload
        ? (payload as { data: T }).data
        : payload as T;
      return { ok: true, data };
    } catch (error) {
      clearTimeout(timer);

      if (retries > 0 && isRetryable(error)) {
        await sleep(getBackoffDelay(maxRetries - retries));
        return request<T>(method, path, body, retries - 1, internalKind);
      }

      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown network error',
        },
      };
    }
  }

  async function requestForReporter<T>(
    method: string,
    path: string,
    reporterToken: string,
    body?: unknown,
  ): Promise<MushiApiResponse<T>> {
    const tokenHash = await sha256Hex(reporterToken);
    const ts = String(Date.now());
    const hmac = await hmacSha256Hex(apiKey, `${projectId}.${ts}.${tokenHash}`);
    const url = `${baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': apiKey,
        'X-Mushi-Project': projectId,
        [MUSHI_INTERNAL_HEADER]: 'reporter-poll',
        'X-Reporter-Token-Hash': tokenHash,
        'X-Reporter-Ts': ts,
        'X-Reporter-Hmac': hmac,
      },
      body: body ? JSON.stringify(body) : undefined,
      [MUSHI_INTERNAL_INIT_MARKER]: 'reporter-poll',
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: MushiInternalRequestKind });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: {
          code: `HTTP_${response.status}`,
          message: (errorBody as { error?: { message?: string }; message?: string }).error?.message
            ?? (errorBody as { message?: string }).message
            ?? `HTTP ${response.status} error`,
        },
      };
    }
    const payload = await response.json();
    return { ok: true, data: (payload as { data: T }).data ?? (payload as T) };
  }

  return {
    async submitReport(report: MushiReport) {
      return request<{ reportId: string }>('POST', '/v1/reports', report, maxRetries, 'report-submit');
    },

    async getReportStatus(reportId: string) {
      return request<{ status: MushiReportStatus }>('GET', `/v1/reports/${reportId}/status`, undefined, maxRetries, 'report-status');
    },

    async getSdkConfig() {
      return request<MushiRuntimeSdkConfig>('GET', '/v1/sdk/config', undefined, maxRetries, 'sdk-config');
    },

    async getLatestSdkVersion(packageName: string) {
      const query = new URLSearchParams({ package: packageName }).toString();
      return request<MushiSdkVersionInfo>('GET', `/v1/sdk/latest-version?${query}`, undefined, maxRetries, 'sdk-config');
    },

    async listReporterReports(reporterToken: string) {
      return requestForReporter<{ reports: MushiReporterReport[] }>('GET', '/v1/reporter/reports', reporterToken);
    },

    async listReporterComments(reportId: string, reporterToken: string) {
      return requestForReporter<{ comments: MushiReporterComment[] }>(
        'GET',
        `/v1/reporter/reports/${reportId}/comments`,
        reporterToken,
      );
    },

    async replyToReporterReport(reportId: string, reporterToken: string, body: string) {
      return requestForReporter<{ comment: MushiReporterComment }>(
        'POST',
        `/v1/reporter/reports/${reportId}/reply`,
        reporterToken,
        { body },
      );
    },
  };
}

async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 10_000);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true; // network failures
  return false;
}
