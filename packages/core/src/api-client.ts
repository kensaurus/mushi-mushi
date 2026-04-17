import type { MushiApiClient, MushiApiResponse, MushiReport, MushiReportStatus } from './types';

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
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Wave C C7: data residency — follow a one-shot redirect when the
      // gateway tells us the project lives in a different region. Cache the
      // new base URL so subsequent calls go straight to the right cluster.
      if (response.status === 307 || response.status === 308) {
        const target = response.headers.get('Location');
        if (target && retries > 0) {
          const targetBase = target.replace(/\/v1\/.*$/, '').replace(/\/$/, '');
          if (targetBase !== baseUrl) {
            baseUrl = targetBase;
            return request<T>(method, path, body, retries - 1);
          }
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        if (response.status >= 500 && retries > 0) {
          await sleep(getBackoffDelay(maxRetries - retries));
          return request<T>(method, path, body, retries - 1);
        }
        return {
          ok: false,
          error: {
            code: `HTTP_${response.status}`,
            message:
              (errorBody as { message?: string }).message || `HTTP ${response.status} error`,
          },
        };
      }

      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (error) {
      clearTimeout(timer);

      if (retries > 0 && isRetryable(error)) {
        await sleep(getBackoffDelay(maxRetries - retries));
        return request<T>(method, path, body, retries - 1);
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

  return {
    async submitReport(report: MushiReport) {
      return request<{ reportId: string }>('POST', '/v1/reports', report);
    },

    async getReportStatus(reportId: string) {
      return request<{ status: MushiReportStatus }>('GET', `/v1/reports/${reportId}/status`);
    },
  };
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
