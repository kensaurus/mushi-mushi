import type {
  MushiApiClient,
  MushiApiResponse,
  MushiAssistantReply,
  MushiCrossAppReport,
  MushiLeaderboardEntry,
  MushiPageContext,
  MushiReport,
  MushiReportStatus,
  MushiReporterComment,
  MushiReporterReport,
  MushiRuntimeSdkConfig,
  MushiSdkVersionInfo,
  MushiTesterReputation,
  MushiTierResult,
} from './types';
import { checkReportPayloadSize } from './payload-guard';
import { sha256Hex, hmacSha256Hex } from './digest';

// One-time credential-failure warning gate — emitted at most once per JS
// process so it's visible without flooding the console on every queued retry.
let _credWarningEmitted = false;

/** Header carrying the signed end-user identity token (verified server-side). */
export const MUSHI_USER_TOKEN_HEADER = 'X-Mushi-User-Token';
/** Project scope header — paired with the API key on every SDK request. */
export const MUSHI_PROJECT_HEADER = 'X-Mushi-Project';
/** Build-time SDK package identity — recorded on every authenticated heartbeat. */
export const MUSHI_SDK_PACKAGE_HEADER = 'X-Mushi-SDK-Package';
export const MUSHI_SDK_VERSION_HEADER = 'X-Mushi-SDK-Version';

/** Build the standard authenticated SDK ingest headers (shared by api-client + offline flush). */
export function buildSdkIngestHeaders(opts: {
  apiKey: string;
  projectId: string;
  sdkPackage?: string;
  sdkVersion?: string;
  userToken?: string | null;
  internalKind?: MushiInternalRequestKind;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mushi-Api-Key': opts.apiKey,
    [MUSHI_PROJECT_HEADER]: opts.projectId,
  };
  if (opts.sdkPackage) headers[MUSHI_SDK_PACKAGE_HEADER] = opts.sdkPackage;
  if (opts.sdkVersion) headers[MUSHI_SDK_VERSION_HEADER] = opts.sdkVersion;
  if (opts.userToken) headers[MUSHI_USER_TOKEN_HEADER] = opts.userToken;
  if (opts.internalKind) headers[MUSHI_INTERNAL_HEADER] = opts.internalKind;
  return headers;
}

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
  /** When set, sent on every request so heartbeats record the running SDK version. */
  sdkPackage?: string;
  sdkVersion?: string;
  /**
   * Returns the current signed end-user identity JWT, or null when the user is
   * anonymous. When present it is sent on the X-Mushi-User-Token header so the
   * backend can verify it and scope identity-bound features to that user.
   */
  getUserToken?: () => string | null | undefined;
}

// V5.3 (M-cross-cutting): canonical Cloud URL — the older `api.mushimushi.dev`
// hostname was never wired up. Self-hosted users MUST override `apiEndpoint`.
export const DEFAULT_API_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api';
export const MUSHI_INTERNAL_HEADER = 'X-Mushi-Internal';
export const MUSHI_INTERNAL_INIT_MARKER = '__mushiInternal';

export type MushiInternalRequestKind = 'sdk-config' | 'report-submit' | 'report-status' | 'reporter-poll' | 'diagnose' | 'discovery' | 'community';

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_RETRIES = 2;

export function createApiClient(options: ApiClientOptions): MushiApiClient {
  const {
    projectId,
    apiKey,
    apiEndpoint = DEFAULT_API_ENDPOINT,
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
    getUserToken,
    sdkPackage,
    sdkVersion,
  } = options;

  let baseUrl = apiEndpoint.replace(/\/$/, '');

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = maxRetries,
    internalKind?: MushiInternalRequestKind,
    extraHeaders?: Record<string, string>,
  ): Promise<MushiApiResponse<T>> {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const userToken = getUserToken?.() ?? null;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...buildSdkIngestHeaders({
            apiKey,
            projectId,
            sdkPackage,
            sdkVersion,
            userToken,
            internalKind,
          }),
          ...extraHeaders,
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
            return request<T>(method, path, body, retries - 1, internalKind, extraHeaders);
          }
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));

        // Surface credential failures immediately — they'll never succeed on
        // retry and silently queuing them offline misleads the developer.
        if ((response.status === 401 || response.status === 403) && !_credWarningEmitted) {
          _credWarningEmitted = true;
          // Only point to the hosted console when this client is actually using
          // the hosted Cloud endpoint — self-hosted deployments (custom
          // apiEndpoint) have their own console at an address we don't know.
          // Compare the slash-normalized `baseUrl`, not the raw `apiEndpoint`, so
          // a copy-pasted Cloud URL with a trailing slash still counts as Cloud.
          const where =
            baseUrl === DEFAULT_API_ENDPOINT
              ? 'Get the correct values at: https://kensaur.us/mushi-mushi/admin/projects'
              : "Get the correct values from your Mushi console's Projects page.";
          console.error(
            `[Mushi] Credentials rejected (HTTP ${response.status}). ` +
            `Check your Project ID and API key scope (must be "report:write"). ` +
            where,
          );
        }

        if (response.status >= 500 && retries > 0) {
          await sleep(getBackoffDelay(maxRetries - retries));
          return request<T>(method, path, body, retries - 1, internalKind, extraHeaders);
        }
        return {
          ok: false,
          error: {
            code:
              (errorBody as { error?: { code?: string } }).error?.code ||
              `HTTP_${response.status}`,
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
        ...(sdkPackage ? { [MUSHI_SDK_PACKAGE_HEADER]: sdkPackage } : {}),
        ...(sdkVersion ? { [MUSHI_SDK_VERSION_HEADER]: sdkVersion } : {}),
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
      const guard = checkReportPayloadSize(report);
      if (!guard.ok) {
        return {
          ok: false,
          error: {
            code: guard.serializeFailed ? 'SERIALIZE_FAILED' : 'PAYLOAD_TOO_LARGE',
            message: guard.reason ?? 'Report payload exceeds size limit',
          },
        };
      }
      return request<{ reportId: string }>('POST', '/v1/reports', report, maxRetries, 'report-submit');
    },

    async getReportStatus(reportId: string) {
      return request<{ status: MushiReportStatus }>('GET', `/v1/reports/${reportId}/status`, undefined, maxRetries, 'report-status');
    },

    async getSdkConfig() {
      return request<MushiRuntimeSdkConfig>('GET', '/v1/sdk/config', undefined, maxRetries, 'sdk-config');
    },

    async askAssistant(input: { message: string; threadId?: string | null; context?: MushiPageContext | null }) {
      return request<MushiAssistantReply>(
        'POST',
        '/v1/sdk/assistant',
        {
          message: input.message,
          threadId: input.threadId ?? null,
          context: input.context ?? null,
        },
        1,
        'community',
      );
    },

    async getLatestSdkVersion(packageName: string) {
      const query = new URLSearchParams({ package: packageName }).toString();
      return request<MushiSdkVersionInfo>('GET', `/v1/sdk/latest-version?${query}`, undefined, maxRetries, 'sdk-config');
    },

    async postDiscoveryEvent(event) {
      // Discovery is best-effort — only one retry on transient failure
      // and a tighter timeout than report submission. We don't queue
      // these offline because a stale observation is more likely to
      // misinform the proposer than it is to be useful.
      return request<{ accepted: boolean }>(
        'POST',
        '/v1/sdk/discovery',
        event,
        1,
        'discovery',
      );
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

    async replyToReporterReport(
      reportId: string,
      reporterToken: string,
      body: string,
      feedbackSignal?: string,
    ) {
      return requestForReporter<{ comment: MushiReporterComment; feedback?: Record<string, unknown> }>(
        'POST',
        `/v1/reporter/reports/${reportId}/reply`,
        reporterToken,
        { body, ...(feedbackSignal ? { feedback_signal: feedbackSignal } : {}) },
      );
    },

    async reopenReporterReport(reportId: string, reporterToken: string, note?: string) {
      return requestForReporter<{ outcome: Record<string, unknown> }>(
        'POST',
        `/v1/reporter/reports/${reportId}/reopen`,
        reporterToken,
        { note: note ?? '' },
      );
    },

    async listNotifications(reporterToken: string, opts?: { since?: string; limit?: number }) {
      const qs = new URLSearchParams();
      if (opts?.since) qs.set('since', opts.since);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      const suffix = qs.size ? `?${qs.toString()}` : '';
      return requestForReporter<{ notifications: Array<Record<string, unknown>> }>(
        'GET',
        `/v1/notifications${suffix}`,
        reporterToken,
      );
    },

    async markNotificationRead(notificationId: string, reporterToken: string) {
      return requestForReporter<{ ok: boolean }>(
        'POST',
        `/v1/notifications/${notificationId}/read`,
        reporterToken,
        {},
      );
    },

    async listReporterFeatureBoard(reporterToken: string) {
      return requestForReporter<{ tickets: Array<Record<string, unknown>> }>(
        'GET',
        '/v1/reporter/feature-board',
        reporterToken,
      );
    },

    async voteReporterFeatureBoard(requestId: string, reporterToken: string) {
      return requestForReporter<{ voted: boolean; action: string }>(
        'POST',
        `/v1/reporter/feature-board/${requestId}/vote`,
        reporterToken,
        {},
      );
    },

    // ─── Rewards program (P1) ──────────────────────────────────

    async submitActivity(userId, events, opts?: { userTraits?: { email?: string; name?: string; provider?: string }; reporterTokenHash?: string; optedIn?: boolean; hostJwt?: string }) {
      return request<{ accepted: number; total: number }>(
        'POST',
        '/v1/sdk/activity',
        {
          user_id: userId,
          user_traits: opts?.userTraits,
          opted_in: opts?.optedIn,
          reporter_token_hash: opts?.reporterTokenHash,
          // P2: JWT for monetary verification; omitted when null
          ...(opts?.hostJwt ? { host_jwt: opts.hostJwt } : {}),
          events,
        },
        1, // best-effort, 1 retry
        'discovery',
      );
    },

    async getMyPoints(userId) {
      return request<{ total_points: number; points_30d: number; points_lifetime: number; tier: MushiTierResult | null }>(
        'GET',
        `/v1/sdk/me/points?userId=${encodeURIComponent(userId)}`,
        undefined,
        1,
        'reporter-poll',
      );
    },

    async getMyTier(userId) {
      return request<MushiTierResult | null>(
        'GET',
        `/v1/sdk/me/tier?userId=${encodeURIComponent(userId)}`,
        undefined,
        1,
        'reporter-poll',
      );
    },

    async getMyHistory(userId, opts) {
      const qs = new URLSearchParams({ userId, ...(opts?.limit ? { limit: String(opts.limit) } : {}) });
      return request<{ items: unknown[]; total: number }>(
        'GET',
        `/v1/sdk/me/history?${qs}`,
        undefined,
        1,
        'reporter-poll',
      );
    },

    async getHallOfFame(limit = 10) {
      return request<{
        data: Array<{
          display_name: string;
          email_hash: string | null;
          tier_slug: string | null;
          tier_name: string | null;
          points_30d: number;
          total_points: number;
        }>;
        meta: { project_name: string };
      }>(
        'GET',
        `/v1/sdk/hall-of-fame?limit=${limit}`,
        undefined,
        1,
        'reporter-poll',
      );
    },

    // ─── Cross-app community (in-widget tester identity) ──────────

    async sendMagicLink(email: string) {
      return request<{ ok: boolean }>(
        'POST',
        '/v1/tester/magic-link',
        { email },
        1,
        'community',
      );
    },

    async linkReporterToken(reporterTokenHash: string, jwt: string) {
      return request<{ ok: boolean; linked: number }>(
        'POST',
        '/v1/tester/link-reporter',
        { reporter_token_hash: reporterTokenHash },
        1,
        'community',
        { Authorization: `Bearer ${jwt}` },
      );
    },

    async getCrossAppReports(jwt: string, opts?: { limit?: number; offset?: number }) {
      const qs = new URLSearchParams();
      if (opts?.limit)  qs.set('limit',  String(opts.limit));
      if (opts?.offset) qs.set('offset', String(opts.offset));
      const suffix = qs.size ? `?${qs.toString()}` : '';
      return request<{ reports: MushiCrossAppReport[] }>(
        'GET',
        `/v1/tester/cross-app-reports${suffix}`,
        undefined,
        1,
        'community',
        { Authorization: `Bearer ${jwt}` },
      );
    },

    async getMyReputation(jwt: string) {
      return request<{ reputation: MushiTesterReputation | null }>(
        'GET',
        '/v1/tester/reputation',
        undefined,
        1,
        'community',
        { Authorization: `Bearer ${jwt}` },
      );
    },

    async getPublicLeaderboard(limit = 20) {
      return request<{ leaderboard: MushiLeaderboardEntry[] }>(
        'GET',
        `/v1/public/tester-leaderboard?limit=${limit}`,
        undefined,
        1,
        'reporter-poll',
      );
    },

    async getTesterStatus(jwt: string) {
      return request<{ is_tester: boolean; tester_id: string | null; public_handle: string | null; display_name: string | null }>(
        'GET',
        '/v1/me/tester-status',
        undefined,
        1,
        'community',
        { Authorization: `Bearer ${jwt}` },
      );
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
