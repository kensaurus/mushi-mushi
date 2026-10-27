import { Hono } from 'npm:hono@4';
import { cors } from 'npm:hono@4/cors';
import { PUBLIC_CORS_MAX_AGE_SECONDS } from '../_shared/cors.ts';
import type { Variables } from './types.ts';

import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts';
import { requestLoggingMiddleware } from '../_shared/request-logging.ts';
import { stdioMcpUsage } from '../_shared/mcp-stdio-usage.ts';
import { proxyToFunction } from '../_shared/edge-proxy.ts';
import { registerSdkAssistantRoutes } from './routes/sdk-assistant.ts';
import { registerConsoleKnowledgeRoutes } from './routes/console-knowledge.ts';
import { registerAdminOpsRoutes } from './routes/admin-ops.ts';
import { registerSiteWatchRoutes } from './routes/site-watch.ts';
import { registerByokSpendDownRoutes } from './routes/byok-spend-down.ts';
import { registerByokCursorModelsRoutes } from './routes/byok-cursor-models.ts';
import { registerByokReviewFollowupRoutes } from './routes/byok-review-followups.ts';
import { registerBillingChangePlanRoutes } from './routes/billing-change-plan.ts';
import { registerDoctorRoutes } from './routes/doctor.ts';
import { registerBillingProjectsQueueGraphRoutes } from './routes/billing-projects-queue-graph.ts';
import { registerCodebaseRoutes } from './routes/codebase.ts';
import { registerRepoDigestRoutes } from './routes/repo-digest.ts';
import { registerRepoDiagramRoutes } from './routes/repo-diagram.ts';
import {
  registerPreRegionDiscoveryRoutes,
  registerPostRegionDiscoveryRoutes,
} from './routes/discovery.ts';
import { registerEnterpriseIntegrationsRoutes } from './routes/enterprise-integrations.ts';
import { registerFixDispatchRoutes } from './routes/fix-dispatch.ts';
import { registerMigrationProgressRoutes } from './routes/migration-progress.ts';
import { registerOrganizationRoutes } from './routes/organizations.ts';
import { registerPublicRoutes } from './routes/public.ts';
import { registerQueryFixesRepoRoutes } from './routes/query-fixes-repo.ts';
import { registerReportsDashboardRoutes } from './routes/reports-dashboard.ts';
import { registerSettingsResearchRoutes } from './routes/settings-research.ts';
import { registerA2ATaskRoutes } from './routes/a2a-tasks.ts';
import { registerOpenApiRoute } from './routes/openapi.ts';
import { registerSchemaRoutes } from './routes/schemas.ts';
import { registerRewardsRoutes } from './routes/rewards.ts';
import { registerEraseSubjectRoutes } from './routes/erase-subject.ts';
import { registerCliAuthRoutes } from './routes/cli-auth.ts';
import { registerMcpOauthRoutes } from './routes/mcp-oauth.ts';
// ---------------------------------------------------------------------------
// Closed-loop evolution + experiment routes.
// middleware/ and _shared/auth.getOrgIdFromContext now exist — safe to import.
import { registerLessonsRoutes } from './routes/lessons.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerReleasesRoutes } from './routes/releases.ts';
import { registerReporterAdminRoutes } from './routes/reporter-admin.ts';
import { registerPdcaRoutes } from './routes/pdca.ts';
import { registerMcpAdminRoutes } from './routes/mcp-admin.ts';
import { registerDriftRoutes } from './routes/drift.ts';
import { registerExperimentsRoutes } from './routes/experiments.ts';
import { registerAnomaliesRoutes } from './routes/anomalies.ts';
import { registerCostsRoutes } from './routes/costs.ts';
import { registerEvolutionRoutes } from './routes/evolution.ts';
import { registerCommunityRoutes } from './routes/community.ts';
import { registerPublishedAppsRoutes } from './routes/published-apps.ts';
import { registerDbAdvisorsRoutes } from './routes/db-advisors.ts';
import { registerContentQualityRoutes } from './routes/content-quality.ts';
import { registerFeatureBoardRoutes } from './routes/feature-board.ts';
import { registerBackendRoutes } from './routes/backend.ts';
import { registerCodeHealthRoutes } from './routes/code-health.ts';
import { registerRecipeRoutes } from './routes/recipe.ts';
import { registerPortfolioRoutes } from './routes/portfolio.ts';
import { registerRadarRoutes } from './routes/radar.ts';
import { registerDigestRoutes } from './routes/digest.ts';
import { registerConnectorRoutes } from './routes/connectors.ts';
import { registerRecipeIngestRoutes } from './routes/recipe-ingest.ts';
import { registerAccountsRegisterRoutes } from './routes/accounts-register.ts';
import { registerRecipeChangeRoutes } from './routes/recipe-changes.ts';
import { registerStoreOpsRoutes } from './routes/store-ops.ts';
import { registerFindingExplainRoutes } from './routes/finding-explain.ts';
import { registerGateFindingDismissRoutes } from './routes/gate-finding-dismiss.ts';
import { registerPortfolioFunnelRoutes } from './routes/portfolio-funnel.ts';
import { registerSpendLedgerRoutes } from './routes/spend-ledger.ts';
import { registerStoreReviewIntakeRoutes } from './routes/store-review-intake.ts';
import { registerWorkspaceNavMetaRoutes } from './routes/workspace-nav-meta.ts';
import { registerActivationRoutes } from './routes/activation.ts';
import { registerSdkUpgradeRoutes } from './routes/sdk-upgrade.ts';
import { registerPullRequestRoutes } from './routes/pull-requests.ts';
import { registerUxCloudRoutes } from './routes/ux-cloud.ts';
import { registerProjectGroupRoutes } from './routes/project-groups.ts';
import { registerBootstrapRoutes } from './routes/bootstrap.ts';
import { registerIdentitySecretRoutes } from './routes/identity-secret.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerGrowthRoutes } from './routes/growth.ts';
import { registerEventsAdminRoutes } from './routes/events-admin.ts';
import { registerLifecycleEmailRoutes } from './routes/lifecycle-emails.ts';
import { registerSlackEventsRoutes } from './routes/slack-events.ts';
import { registerTelegramAdminRoutes } from './routes/telegram-admin.ts';
import { registerIntakeVoiceRoutes } from './routes/intake-voice.ts';
import { registerPushRoutes } from './routes/push.ts';
import { registerSentryImportRoutes } from './routes/sentry-import.ts';
import { registerReportFileRoutes } from './routes/report-file.ts';

ensureSentry('api');

// basePath('/api') is required by Supabase Edge Functions: the function name
// is included in the request URL path (https://supabase.com/docs/guides/functions/routing).
const app = new Hono<{ Variables: Variables }>().basePath('/api');

app.onError(sentryHonoErrorHandler);

// Route groups that run in the `api-ext` function (deploy size limit, see
// _shared/edge-proxy.ts). Registered where the groups used to be, so route
// order is unchanged; the public paths stay on `api`.
function forwardToApiExt(paths: string[]): void {
  for (const path of paths) {
    app.all(path, (c) =>
      proxyToFunction(c.req.raw, 'api-ext', c.req.path.replace(/^\/api(?=\/)/, ''), {
        supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
      }),
    );
  }
}

app.use('*', requestLoggingMiddleware());
// Records tool calls from the stdio MCP server (npx @mushi-mushi/mcp) after the
// route's own auth has run; a no-op for every other caller.
app.use('/v1/*', stdioMcpUsage());

// SEC (Wave S1 / D-18 + S-5): split CORS policy.
//
// SDK ingest endpoints (/v1/reports, /v1/region/*, /v1/webhooks/*, /.well-known/*)
// must accept any Origin — any host embedding the widget may post bugs.
//
// Admin endpoints (/v1/admin/**) carry a Supabase JWT and sensitive tenant
// data. `origin: '*'` + `credentials: true` is forbidden by the browser, and
// even without credentials a wildcard invites cross-origin XHR from anywhere
// to drain the admin JSON surface post-login via leaked tokens. We restrict
// those to an env-driven allowlist, defaulting to the production admin host.
const ADMIN_ORIGIN_ALLOWLIST = ((): string[] => {
  const raw = (Deno.env.get('MUSHI_ADMIN_ORIGIN_ALLOWLIST') ?? '').trim();
  const defaults = [
    'https://kensaur.us',
    'https://www.kensaur.us',
    // Local dev for the admin Vite server. `apps/admin/README.md` pins the
    // canonical dev port to 6464; the legacy 5173 entries are kept for
    // operators who overrode Vite's port. Extend via
    // MUSHI_ADMIN_ORIGIN_ALLOWLIST for anything else.
    'http://localhost:6464',
    'http://127.0.0.1:6464',
    'http://localhost:6465',
    'http://127.0.0.1:6465',
    'http://localhost:6466',
    'http://127.0.0.1:6466',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    // Common alternate Vite ports when 6464 is occupied.
    'http://localhost:5180',
    'http://127.0.0.1:5180',
    // Dev-only: paired dogfood app (glot.it) runs on Next.js :3000 and
    // occasionally hits admin debug endpoints when the `local` target is
    // selected. The same origin is re-validated by JWT + RLS server-side,
    // so CORS is not the only gate — but without this entry the browser
    // would block the response even with a valid token.
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  const extra = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return Array.from(new Set([...defaults, ...extra]));
})();

// Public SDK / widget / webhook paths: Access-Control-Allow-Origin: *
// Note: 'baggage' and 'sentry-trace' are W3C / Sentry tracing headers emitted
// by every host app that instruments Sentry. Without them in allowHeaders the
// browser blocks all SDK preflight requests with a CORS error.
//
// X-Mushi-SDK-* + X-Mushi-User-Token are stamped on every authenticated SDK
// heartbeat (Jun 2026 sdk-observation). Omitting them breaks browser preflight
// when host apps call /v1/sdk/latest-version directly against the cloud API.
const SDK_OBSERVATION_HEADERS = [
  'X-Mushi-SDK-Version',
  'X-Mushi-SDK-Package',
  'X-Mushi-User-Token',
  // Host JWT proving the end user's identity on the privacy routes
  // (GET /v1/sdk/me/export, DELETE /v1/sdk/me) when the project verifies users.
  'X-Mushi-Host-Jwt',
] as const;

// The SDK does far more than GET here: the browser widget POSTs rewards
// activity (/v1/sdk/activity), passive discovery (/v1/sdk/discovery), the
// page-aware assistant (/v1/sdk/assistant), consent (/v1/sdk/me/consent),
// payout onboarding (/v1/sdk/me/payout/onboard) and experiment events, and
// DELETEs for GDPR erasure (/v1/sdk/me). A previous `['GET','OPTIONS']` list
// made every one of those fail the browser preflight (works on native, which
// doesn't enforce CORS — hence "broken on websites only"). Mirror the
// /v1/reports method set so any future SDK verb is covered without a regression
// hunt. Origin stays '*' because these are project-API-key authenticated.
app.use(
  '/v1/sdk/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'baggage',
      'sentry-trace',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/reports',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'X-Sentry-Hook-Signature',
      'baggage',
      'sentry-trace',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/reports/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'X-Sentry-Hook-Signature',
      'baggage',
      'sentry-trace',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
// Span ingest endpoint (OTel trace correlation). Accepts traceparent/tracestate
// so the node SDK can forward W3C headers along with span payloads.
app.use(
  '/v1/ingest/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'traceparent',
      'tracestate',
    ],
    allowMethods: ['POST', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/reporter/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
      'baggage',
      'sentry-trace',
    ],
    // PUT / DELETE: notification prefs and push subscriptions (Plan 018 §4.1).
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/notifications/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
      'baggage',
      'sentry-trace',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/notifications',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
      ...SDK_OBSERVATION_HEADERS,
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
      'baggage',
      'sentry-trace',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: PUBLIC_CORS_MAX_AGE_SECONDS,
  }),
);
app.use(
  '/v1/webhooks/*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Sentry-Hook-Signature',
      'X-GitHub-Event',
      'X-Hub-Signature-256',
      'Sentry-Hook-Signature',
    ],
    allowMethods: ['POST', 'OPTIONS'],
  }),
);
app.use('/v1/region/*', cors({ origin: '*' }));
app.use('/v1/public/*', cors({ origin: '*' }));
app.use('/.well-known/*', cors({ origin: '*' }));
app.use('/health', cors({ origin: '*' }));

// Every header apps/admin's apiFetch stamps on EVERY request (supabase.ts):
// the tenant scope pair, its legacy alias, the correlation id and the
// idempotency key. Browsers name all of them in the preflight, so any cors()
// entry a console page can reach must allow the whole set or the OPTIONS
// fails with "Request header field x-request-id is not allowed" — which the
// page only ever sees as `TypeError: Failed to fetch`, reading like an
// outage. Centralised here, above the FIRST cors() that needs it (the tester
// and /v1/me entries below are reached from the console's Tester portal), so
// a new admin-side header is added in one place instead of drifting across
// every entry.
const ADMIN_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Mushi-Project-Id',
  'X-Mushi-Org-Id',
  // Legacy alias stamped alongside X-Mushi-Org-Id by apps/admin apiFetch.
  // Omitting it fails the whole OPTIONS with "x-org-id is not allowed" —
  // CLI device approve and every admin page went dark that way once.
  'x-org-id',
  'X-Request-Id',
  'Idempotency-Key',
];

/** Browser-visible response headers for admin apiFetch correlation. */
const ADMIN_EXPOSE_HEADERS = ['X-Request-Id'];

/** Tracing headers the SDK widget adds on top of the console's set. */
const WIDGET_TRACE_HEADERS = ['baggage', 'sentry-trace'];

// Community tester endpoints: called directly from the SDK widget, which runs
// on arbitrary host app domains, AND from the console's own Tester portal
// (the Portal switch in the sidebar). Must be CORS-open so preflight
// succeeds, and must allow the console's headers: with only the widget's
// four listed, /v1/me/tester-status rejected the console's X-Request-Id
// preflight and every Tester page rendered "Could not load your tester
// profile — Failed to fetch". Auth is enforced per-route via jwtAuth
// middleware — CORS and auth are orthogonal.
app.use(
  '/v1/tester/*',
  cors({
    origin: '*',
    allowHeaders: [...ADMIN_ALLOWED_HEADERS, ...WIDGET_TRACE_HEADERS],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);
app.use(
  '/v1/me/*',
  cors({
    origin: '*',
    allowHeaders: [...ADMIN_ALLOWED_HEADERS, ...WIDGET_TRACE_HEADERS],
    allowMethods: ['GET', 'OPTIONS'],
  }),
);

// Admin paths: allowlist. Hono's cors() already reflects the request Origin
// back as Access-Control-Allow-Origin when it matches; unknown origins get
// no ACAO header so the browser blocks the response.
//
// Migration Hub docs sync exception: /v1/admin/migrations/* is also reachable
// from the docs site (apps/docs) so logged-in users can sync their checklist
// progress across devices. We keep this BEFORE the general /v1/admin/*
// matcher (Hono evaluates middleware in registration order; first match
// wins) and use a strictly wider-but-still-allowlisted origin set, so the
// rest of the admin surface remains pinned to the admin allowlist.
const DOCS_ORIGIN_ALLOWLIST = ((): string[] => {
  const raw = (Deno.env.get('MUSHI_DOCS_ORIGIN_ALLOWLIST') ?? '').trim();
  const defaults = [
    // Public docs static export at kensaur.us/mushi-mushi/docs
    'https://kensaur.us',
    'https://www.kensaur.us',
    // Local dev for the docs Next.js server. Nextra dev defaults to :3000;
    // operators sometimes pin to :3001 to coexist with the dogfood app.
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  const extra = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return Array.from(new Set([...defaults, ...extra]));
})();

const MIGRATIONS_PROGRESS_ORIGINS = Array.from(
  new Set([...ADMIN_ORIGIN_ALLOWLIST, ...DOCS_ORIGIN_ALLOWLIST]),
);

// ADMIN_ALLOWED_HEADERS / ADMIN_EXPOSE_HEADERS are declared further up, above
// the /v1/tester and /v1/me entries — the first cors() entries the console's
// apiFetch reaches — so the whole file shares one list (and no TDZ pitfall).

app.use(
  '/v1/admin/migrations/*',
  cors({
    origin: (origin) => (MIGRATIONS_PROGRESS_ORIGINS.includes(origin) ? origin : null),
    // The docs sync hook also sends X-Mushi-Project-Id when the user is
    // syncing project-scoped progress. The admin's apiFetch unconditionally
    // appends X-Mushi-Org-Id whenever an org is active (see
    // apps/admin/src/lib/supabase.ts) — without it on the allowlist the
    // browser drops every preflight from /projects (which mounts the
    // migration progress widget) and the page renders with a stale
    // "fetch-rejected" state. Adding it here is safe: the docs site never
    // sends this header, so the only callers exercising this entry are the
    // admin and the docs Migration Hub. Pulled from the shared
    // ADMIN_ALLOWED_HEADERS constant so a future header addition lands in
    // one place rather than drifting per-entry.
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.use(
  '/v1/admin/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
// Super-admin diagnostic endpoints (e.g. /v1/super-admin/users) are JWT-authed
// and called from the admin console with the same header set as /v1/admin/*.
// Without this dedicated entry the route falls through to the wildcard
// catch-all and the preflight loses X-Mushi-Project-Id / X-Mushi-Org-Id,
// which dropped silently because no UI surface had exercised it yet.
app.use(
  '/v1/super-admin/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use(
  '/v1/org/*',
  cors({
    // apps/admin/src/lib/supabase.ts injects BOTH X-Mushi-Project-Id and
    // X-Mushi-Org-Id on every apiFetch call (so caches stay scoped per
    // org+project), even on /v1/org endpoints. Both must be in the
    // allowlist or the browser drops the preflight.
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use(
  '/v1/invitations/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    // GET is for /v1/invitations/preview which resolves a token into the
    // org/inviter/role panel rendered before the user clicks Accept. The
    // route is unauthenticated (the token IS the bearer), but we still
    // gate CORS on the admin allowlist because the preview is only ever
    // rendered from the admin app.
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);
// /v1/support/* is admin-surfaced (apps/admin renders the "Need help?" panel
// on /billing). The contact form submits to POST /v1/support/contact — note
// the path lives outside /v1/admin/* because anonymous self-hosters may
// later need to ping support without an admin JWT. Until then it's still
// JWT-authed, but the FE's apiFetch unconditionally adds X-Mushi-Project-Id
// + X-Mushi-Org-Id, so we need a dedicated CORS entry — without it the
// route falls through to the wildcard catch-all that lacks those headers
// and every "Send ticket" click failed with `TypeError: Failed to fetch`.
app.use(
  '/v1/support/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);
// /v1/marketplace/* is admin-surfaced (apps/admin renders it on /marketplace)
// so the FE's apiFetch sends X-Mushi-Project-Id + X-Mushi-Org-Id. Without
// this dedicated entry the route falls through to the wildcard catch-all
// at the bottom, which only allows the SDK headers — every preflight from
// the admin then fails and /marketplace renders with a stale fetch-rejected
// state. Submissions endpoint is JWT-authed, listing endpoint is public read
// but still goes through the same preflight, so both share this CORS gate.
app.use(
  '/v1/marketplace/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ADMIN_ALLOWED_HEADERS,
    exposeHeaders: ADMIN_EXPOSE_HEADERS,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);

// Fallback: anything we haven't classified (rare — mcp, internal future
// admin paths) gets the safer admin allowlist. Defense in depth: we also
// allow the admin header set here so a NEW JWT-authed admin route added
// without a dedicated cors() entry above doesn't silently break preflight
// (the failure mode that bit /v1/support/contact). Origin restriction stays
// strict so this can never widen access — only the headers grow. The legacy
// SDK headers (X-Mushi-Api-Key, X-Mushi-Project, X-Mushi-Internal) stay on
// the list so anything else falling through that the SDK might call still
// works without a regression hunt.
app.use(
  '*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: [
      ...ADMIN_ALLOWED_HEADERS,
      'X-Mushi-Api-Key',
      'X-Mushi-Project',
      'X-Mushi-Internal',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

registerPreRegionDiscoveryRoutes(app);

registerPostRegionDiscoveryRoutes(app);

registerPublicRoutes(app);

registerFixDispatchRoutes(app);

registerCodebaseRoutes(app);

forwardToApiExt([
  // Codebase Atlas (codebase-understand.ts); deploy size limit, 2026-10-22.
  '/v1/admin/projects/:id/codebase/analyze',
  '/v1/admin/projects/:id/codebase/analyze/:jobId',
  '/v1/admin/projects/:id/codebase/chat',
  '/v1/admin/projects/:id/codebase/chat/stream',
  '/v1/admin/projects/:id/codebase/chat/threads',
  '/v1/admin/projects/:id/codebase/chat/threads/:threadId',
  '/v1/admin/projects/:id/codebase/chat/threads/:threadId/messages',
  '/v1/admin/projects/:id/codebase/domains',
  '/v1/admin/projects/:id/codebase/impact',
  '/v1/admin/projects/:id/codebase/knowledge/graph',
  '/v1/admin/projects/:id/codebase/settings',
  '/v1/admin/projects/:id/codebase/summary',
  '/v1/admin/projects/:id/codebase/tour',
  '/v1/admin/projects/:id/codebase/wiki/sources',
  '/v1/admin/projects/:id/codebase/wiki/sources/:sourceId/retry',
]);

registerRepoDigestRoutes(app);

registerRepoDiagramRoutes(app);

registerReportsDashboardRoutes(app);

registerSettingsResearchRoutes(app);

forwardToApiExt([
  // Modernization, health history, entitlements, super-admin metrics
  // (modernization-health-super.ts); deploy size limit, 2026-10-22.
  '/v1/admin/entitlements',
  '/v1/admin/health/history',
  '/v1/admin/health/integration/:kind',
  '/v1/admin/modernization',
  '/v1/admin/modernization/:id/dismiss',
  '/v1/admin/modernization/:id/dispatch',
  '/v1/super-admin/metrics',
  '/v1/super-admin/users',
  '/v1/super-admin/users/:id',
]);

registerBillingProjectsQueueGraphRoutes(app);

registerActivationRoutes(app);

forwardToApiExt(['/v1/admin/ask-mushi', '/v1/admin/ask-mushi/*', '/v1/admin/assist']);
registerConsoleKnowledgeRoutes(app);
registerSdkAssistantRoutes(app);

registerQueryFixesRepoRoutes(app);

registerOrganizationRoutes(app);

registerEnterpriseIntegrationsRoutes(app);

registerMigrationProgressRoutes(app);

registerAdminOpsRoutes(app);

// Live-site watch: Firecrawl monitors that file broken pages as reports (ADR 0024).
registerSiteWatchRoutes(app);
registerByokSpendDownRoutes(app);
// Review follow-ups (ADR 0032) register GET /v1/admin/byok/cursor/models
// (cache, universal keys, another app's key for an owner or admin). Hono
// serves that first handler. Spend-down and Integrations (BL-090) register
// the same path.
registerByokReviewFollowupRoutes(app);
registerByokCursorModelsRoutes(app);

// In-app plan change (Indie ↔ Pro, monthly ↔ annual) for paying projects.
registerBillingChangePlanRoutes(app);

registerDoctorRoutes(app);

forwardToApiExt(['/v1/admin/inventory', '/v1/admin/inventory/*']);

forwardToApiExt([
  // qa-coverage.ts; deploy size limit, 2026-10-22.
  '/v1/admin/projects/:pid/platform-rollup',
  '/v1/admin/projects/:pid/qa-coverage',
  '/v1/admin/projects/:pid/qa-coverage-summary',
  '/v1/admin/projects/:pid/qa-coverage/stats',
  '/v1/admin/projects/:pid/qa-stories',
  '/v1/admin/projects/:pid/qa-stories/:sid',
  '/v1/admin/projects/:pid/qa-stories/:sid/run',
  '/v1/admin/projects/:pid/qa-stories/:sid/runs',
  '/v1/admin/projects/:pid/qa-stories/:sid/runs/:rid/evidence',
]);

registerRewardsRoutes(app);

// Host-backend account deletion: erase one end user's reports + reporter data.
// Erase-token auth (identity secret), not the SDK key. The /v1/sdk/* CORS
// policy above matches this path, but X-Mushi-Erase-Token is not in its
// allowHeaders, so a browser preflight fails: only host servers can call it.
registerEraseSubjectRoutes(app);

// RFC 8628 device-auth (CLI login) + CLI-authenticated project endpoints.
registerCliAuthRoutes(app);

// OAuth 2.1 authorization-code (+ PKCE) flow for MCP client login
// (`claude mcp login`, Cursor, VS Code). The mcp function's /oauth/*
// endpoints delegate here.
registerMcpOauthRoutes(app);

// Closed-loop evolution + experiment routes.
registerLessonsRoutes(app);
registerSyncRoutes(app);
registerReleasesRoutes(app);
registerReporterAdminRoutes(app);
registerPdcaRoutes(app);
registerMcpAdminRoutes(app);
registerDriftRoutes(app);
registerExperimentsRoutes(app);
registerAnomaliesRoutes(app);
registerCostsRoutes(app);
registerEvolutionRoutes(app);
// tester-marketplace.ts (tester portal, public marketplace and roadmap,
// submission and redemption review, Tremendous webhook); deploy size limit,
// 2026-10-26. Exact /v1/tester/* paths: community.ts serves others there.
forwardToApiExt([
  '/v1/public/marketplace/*',
  '/v1/public/roadmap/*',
  '/v1/me/tester-status',
  '/v1/tester/enroll',
  '/v1/tester/me',
  '/v1/tester/kyc',
  '/v1/tester/export',
  '/v1/tester/delete',
  '/v1/tester/wallet',
  '/v1/tester/wallet/*',
  '/v1/tester/apps',
  '/v1/tester/apps/*',
  '/v1/tester/submissions',
  '/v1/admin/tester-submissions',
  '/v1/admin/tester-submissions/*',
  '/v1/admin/tester-redemptions/*',
  '/v1/webhooks/tremendous',
]);
registerCommunityRoutes(app);
registerPublishedAppsRoutes(app);
registerDbAdvisorsRoutes(app);
registerContentQualityRoutes(app);
registerFeatureBoardRoutes(app);
registerBackendRoutes(app);
forwardToApiExt([
  // fullstack-audit.ts; deploy size limit, 2026-10-22.
  '/v1/admin/fullstack-audit/stats',
  '/v1/admin/projects/:id/audit',
]);
// site-audit.ts (ADR 0040); deploy size limit, 2026-10-23.
forwardToApiExt(['/v1/admin/projects/:id/site-audit', '/v1/admin/projects/:id/site-audit/run']);
// merge-queue.ts (ADR 0041); deploy size limit, 2026-10-23.
forwardToApiExt(['/v1/admin/merge-queue', '/v1/admin/merge-queue/:id', '/v1/admin/projects/:id/release-settings']);
// pipeline.ts (console /pipeline); deploy size limit, 2026-10-26.
forwardToApiExt(['/v1/admin/pipeline', '/v1/admin/pipeline/actions']);

forwardToApiExt(['/v1/admin/projects/:id/local-followups', '/v1/admin/fixes/:id/local-followup', '/v1/admin/fixes/:id/local-followup/done']);
// skill-runs.ts (ADR 0042); deploy size limit, 2026-10-23.
forwardToApiExt(['/v1/admin/skill-runs', '/v1/admin/projects/:id/skill-runs', '/v1/admin/projects/:id/skill-runs/:runId/stop']);
// search-rank.ts; deploy size limit, 2026-10-23.
forwardToApiExt(['/v1/admin/projects/:id/search-ranks', '/v1/admin/projects/:id/search-ranks/run']);
registerCodeHealthRoutes(app);
registerRecipeRoutes(app);
registerPortfolioRoutes(app);
registerRadarRoutes(app);
registerDigestRoutes(app);
registerConnectorRoutes(app);
registerRecipeIngestRoutes(app);
registerAccountsRegisterRoutes(app);
registerRecipeChangeRoutes(app);
registerStoreOpsRoutes(app);
registerFindingExplainRoutes(app);
registerGateFindingDismissRoutes(app);
registerPortfolioFunnelRoutes(app);
registerSpendLedgerRoutes(app);
registerStoreReviewIntakeRoutes(app);
registerWorkspaceNavMetaRoutes(app);
// Agent skills (skills.ts); deploy size limit, 2026-10-22.
forwardToApiExt(['/v1/admin/skills', '/v1/admin/skills/*']);
// Claude models the app's Anthropic key can use (anthropic-models.ts), for the settings model pickers.
forwardToApiExt(['/v1/admin/byok/anthropic/models']);
registerSdkUpgradeRoutes(app);
registerUxCloudRoutes(app);
forwardToApiExt([
  // ux-runs.ts; deploy size limit, 2026-10-22.
  '/v1/admin/projects/:pid/ux-runs',
  '/v1/admin/projects/:pid/ux-runs/:runId',
  '/v1/admin/projects/:pid/ux-runs/:runId/merge',
  '/v1/admin/projects/:pid/ux-runs/:runId/pull-request',
  '/v1/admin/projects/:pid/ux-runs/:runId/surfaces/:key/report',
  '/v1/admin/projects/:pid/ux-runs/:runId/uploads',
]);
registerPullRequestRoutes(app);
registerProjectGroupRoutes(app);
registerBootstrapRoutes(app);
registerIdentitySecretRoutes(app);
registerSessionRoutes(app);
registerEventRoutes(app);
registerGrowthRoutes(app);
registerEventsAdminRoutes(app);
registerLifecycleEmailRoutes(app);
registerSlackEventsRoutes(app);
registerTelegramAdminRoutes(app);
registerIntakeVoiceRoutes(app);
registerPushRoutes(app);
registerSentryImportRoutes(app);
registerReportFileRoutes(app);
// CI runners you can see (Plan 022): runner ingest, CI overview, re-run tests.
forwardToApiExt(['/v1/admin/ci/*', '/v1/ingest/runner', '/v1/admin/fixes/:id/ci/rerun', '/v1/admin/projects/:id/runner-key']);
// Verified fixes (Plan 024, ADR 0035): settings, gates, re-check, the verify workflow.
forwardToApiExt([
  '/v1/admin/projects/:id/verify-settings',
  '/v1/admin/fixes/:id/verification',
  '/v1/admin/fixes/:id/verify',
  '/v1/admin/projects/:id/verify-workflow',
  '/v1/admin/projects/:id/verify-workflow/pr',
]);
// Known holes in dependencies and the runtime (ADR 0038).
forwardToApiExt(['/v1/admin/projects/:id/vulnerabilities', '/v1/admin/projects/:id/vulnerabilities/*']);
// sdk-health.ts: SDK problems and their fix tasks; deploy size limit, 2026-10-26.
forwardToApiExt(['/v1/admin/projects/:id/sdk-health', '/v1/admin/projects/:id/sdk-health/tasks']);

registerA2ATaskRoutes(app);

registerOpenApiRoute(app);

registerSchemaRoutes(app);

function isStatusZeroRangeError(err: unknown): err is RangeError {
  return (
    err instanceof RangeError &&
    /status.*\(0\)|status.+not equal to 101/i.test(err.message)
  );
}

function clientAbortFallback(): Response {
  // 499 Client Closed Request (Nginx convention) — the connection is already
  // closed so this body is never read by the original requester. We still
  // return a well-formed Response so the Deno server doesn't surface a
  // protocol error in upstream logs.
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: 'CLIENT_CLOSED_REQUEST',
        message:
          'The client disconnected before the response could be written. The connection is already closed.',
      },
    }),
    {
      status: 499,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Boundary guard for the Deno.serve handler.
 *
 * Twin of `sentryHonoErrorHandler` (see `_shared/sentry.ts`) — that one runs
 * INSIDE Hono when compose throws; this one runs OUTSIDE Hono when the throw
 * escaped Hono entirely or when Hono returned a Response with `status === 0`.
 *
 * Status-0 inbound is the documented Deno/Supabase Edge Runtime client-abort
 * shape (see `_shared/sentry.ts`). It is NOT a server bug — log to Supabase
 * Logs only (no Sentry capture) so on-call is not paged for client disconnects.
 */
function logClientAbort(req: Request, extra?: Record<string, unknown>): void {
  const url = new URL(req.url);
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      scope: 'mushi:api-fetch-boundary',
      event: 'client_aborted_response',
      msg: 'client disconnected before response could be written',
      path: url.pathname,
      method: req.method,
      client_abort: true,
      boundary: 'api-fetch',
      ...extra,
    }),
  );
}

async function fetchWithStatusZeroGuard(req: Request): Promise<Response> {
  try {
    const res = await app.fetch(req);

    if (res.status === 0) {
      logClientAbort(req);
      return clientAbortFallback();
    }

    return res;
  } catch (err) {
    if (!isStatusZeroRangeError(err)) throw err;

    logClientAbort(req, {
      range_error_status_0: true,
      url: `${new URL(req.url).origin}${new URL(req.url).pathname}`,
    });
    return clientAbortFallback();
  }
}

Deno.serve(fetchWithStatusZeroGuard);
