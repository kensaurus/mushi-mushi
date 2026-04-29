import { Hono } from 'npm:hono@4';
import { cors } from 'npm:hono@4/cors';

import { ensureSentry, reportMessage, sentryHonoErrorHandler } from '../_shared/sentry.ts';
import { registerAskMushiRoutes } from './routes/ask-mushi.ts';
import { registerAdminOpsRoutes } from './routes/admin-ops.ts';
import { registerBillingProjectsQueueGraphRoutes } from './routes/billing-projects-queue-graph.ts';
import { registerCodebaseRoutes } from './routes/codebase.ts';
import {
  registerPreRegionDiscoveryRoutes,
  registerPostRegionDiscoveryRoutes,
} from './routes/discovery.ts';
import { registerEnterpriseIntegrationsRoutes } from './routes/enterprise-integrations.ts';
import { registerFixDispatchRoutes } from './routes/fix-dispatch.ts';
import { registerMigrationProgressRoutes } from './routes/migration-progress.ts';
import { registerModernizationHealthSuperRoutes } from './routes/modernization-health-super.ts';
import { registerOrganizationRoutes } from './routes/organizations.ts';
import { registerPublicRoutes } from './routes/public.ts';
import { registerQueryFixesRepoRoutes } from './routes/query-fixes-repo.ts';
import { registerReportsDashboardRoutes } from './routes/reports-dashboard.ts';
import { registerSettingsResearchRoutes } from './routes/settings-research.ts';

ensureSentry('api');

// basePath('/api') is required by Supabase Edge Functions: the function name
// is included in the request URL path (https://supabase.com/docs/guides/functions/routing).
const app = new Hono().basePath('/api');

app.onError(sentryHonoErrorHandler);

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
    'https://admin.mushimushi.dev',
    'https://app.mushimushi.dev',
    // Public live demo, pointed at by the README + npm "Live admin demo"
    // links. Hosted from a CloudFront distribution that fronts the GitHub
    // Pages build of `apps/admin`. Both apex and `www.` are kept here so
    // the demo keeps working if a marketing redirect ever flips. Without
    // this entry every /v1/admin/* call from the demo fails CORS preflight
    // even though the JWT + RLS gates would otherwise admit the request.
    'https://kensaur.us',
    'https://www.kensaur.us',
    // Local dev for the admin Vite server. `apps/admin/README.md` pins the
    // canonical dev port to 6464; the legacy 5173 entries are kept for
    // operators who overrode Vite's port. Extend via
    // MUSHI_ADMIN_ORIGIN_ALLOWLIST for anything else.
    'http://localhost:6464',
    'http://127.0.0.1:6464',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
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
app.use(
  '/v1/sdk/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-Mushi-Api-Key', 'X-Mushi-Project', 'X-Mushi-Internal'],
    allowMethods: ['GET', 'OPTIONS'],
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
      'X-Sentry-Hook-Signature',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
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
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
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
      'X-Reporter-Token',
      'X-Reporter-Token-Hash',
      'X-Reporter-Ts',
      'X-Reporter-Hmac',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
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
    'https://docs.mushimushi.dev',
    // Public mirror that fronts the Nextra static export from GitHub Pages.
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

app.use(
  '/v1/admin/migrations/*',
  cors({
    origin: (origin) => (MIGRATIONS_PROGRESS_ORIGINS.includes(origin) ? origin : null),
    // The docs sync hook also sends X-Mushi-Project-Id when the user is
    // syncing project-scoped progress. No org header on this surface.
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Project-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.use(
  '/v1/admin/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Project-Id', 'X-Mushi-Org-Id'],
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
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Project-Id', 'X-Mushi-Org-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use(
  '/v1/invitations/*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Project-Id', 'X-Mushi-Org-Id'],
    allowMethods: ['POST', 'OPTIONS'],
    credentials: true,
  }),
);

// Fallback: anything we haven't classified (rare — mcp, internal) gets the
// safer admin allowlist. Explicit beats implicit.
app.use(
  '*',
  cors({
    origin: (origin) => (ADMIN_ORIGIN_ALLOWLIST.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Api-Key', 'X-Mushi-Project', 'X-Mushi-Internal'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

registerPreRegionDiscoveryRoutes(app);

registerPostRegionDiscoveryRoutes(app);

registerPublicRoutes(app);

registerFixDispatchRoutes(app);

registerCodebaseRoutes(app);

registerReportsDashboardRoutes(app);

registerSettingsResearchRoutes(app);

registerModernizationHealthSuperRoutes(app);

registerBillingProjectsQueueGraphRoutes(app);

registerAskMushiRoutes(app);

registerQueryFixesRepoRoutes(app);

registerOrganizationRoutes(app);

registerEnterpriseIntegrationsRoutes(app);

registerMigrationProgressRoutes(app);

registerAdminOpsRoutes(app);

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
 * shape (see Sentry handler doc). It is NOT a server bug — log it as a
 * warning so it shows up in Sentry's Issues list as a low-priority signal,
 * but never as an exception (which would page on-call and burn error budget
 * for behaviour the operator can do nothing about).
 */
async function fetchWithStatusZeroGuard(req: Request): Promise<Response> {
  try {
    const res = await app.fetch(req);

    if (res.status === 0) {
      const url = new URL(req.url);
      reportMessage('client_aborted_response', 'warning', {
        tags: {
          path: url.pathname,
          method: req.method,
          client_abort: 'true',
          boundary: 'api-fetch',
        },
      });
      return clientAbortFallback();
    }

    return res;
  } catch (err) {
    if (!isStatusZeroRangeError(err)) throw err;

    const url = new URL(req.url);
    reportMessage('client_aborted_response', 'warning', {
      tags: {
        path: url.pathname,
        method: req.method,
        client_abort: 'true',
        range_error_status_0: 'true',
        boundary: 'api-fetch',
      },
      extra: { url: `${url.origin}${url.pathname}` },
    });
    return clientAbortFallback();
  }
}

Deno.serve(fetchWithStatusZeroGuard);
