import type { MushiApiClient, MushiApiResponse, MushiReport, MushiReportStatus } from './types';

export interface ApiClientOptions {
  projectId: string;
  apiKey: string;
  apiEndpoint: string;
  timeout?: number;
  maxRetries?: number;
}

const DEFAULT_API_ENDPOINT = 'https://api.mushimushi.dev';
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

  const baseUrl = apiEndpoint.replace(/\/$/, '');

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
