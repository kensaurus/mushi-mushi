import type { Hono, Context } from 'npm:hono@4';
import { streamSSE } from 'npm:hono@4/streaming';

import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts';
import { AguiEmitter } from '../../_shared/agui.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reportError } from '../../_shared/sentry.ts';
import { apiKeyAuth, jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import {
  requireFeature,
  resolveActiveEntitlement,
  GATED_ROUTES,
  type FeatureFlag,
} from '../../_shared/entitlements.ts';
import { requireSuperAdmin } from '../../_shared/super-admin.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import {
  currentRegion,
  lookupProjectRegion,
  regionEndpoint,
  regionRouter,
} from '../../_shared/region.ts';
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { reportSubmissionSchema } from '../../_shared/schemas.ts';
import { checkAntiGaming } from '../../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../../_shared/telemetry.ts';
import { awardPoints, getReputation } from '../../_shared/reputation.ts';
import { createNotification, buildNotificationMessage } from '../../_shared/notifications.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { getActivePlugins, dispatchPluginEvent } from '../../_shared/plugins.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerPreRegionDiscoveryRoutes(app: Hono): void {
  app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0', region: currentRegion() }));

  // C7: data residency — public lookup so SDKs can prime their region
  // cache before the first call. No auth required; only exposes the region tag.
  app.get('/v1/region/resolve', async (c) => {
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'MISSING_PROJECT_ID' } }, 400);
    }
    const region = (await lookupProjectRegion(projectId)) ?? currentRegion();
    const endpoint = region === 'self' ? '' : regionEndpoint(region);
    return c.json({ ok: true, region, endpoint, currentRegion: currentRegion() });
  });

  // C7: redirect cross-region calls before they hit project-scoped DB
  // queries. Bound to `/v1/*` so static endpoints (health, agent-card, region
  // resolve) keep working uniformly across all clusters.
  app.use('/v1/*', regionRouter);
}

export function registerPostRegionDiscoveryRoutes(app: Hono): void {
  // ============================================================
  // A2A Agent Card
  //
  // Public discovery document for the Mushi Mushi autofix agent, following the
  // Agent-to-Agent (A2A) protocol pattern at `/.well-known/agent-card`.
  // Returned schema mirrors the draft A2A spec: identity, capabilities,
  // supported skills, auth requirements, and a link to the MCP transport.
  // Cache-Control 1h matches the conservative end of A2A discovery guidance.
  // ============================================================
  function buildAgentCard(req: Request): Record<string, unknown> {
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;
    const apiBase = `${origin}/functions/v1/api`;
    const mcpBase = `${origin}/functions/v1/mcp`;

    return {
      schemaVersion: '0.2',
      spec: 'https://github.com/agent-protocol/a2a',
      id: 'dev.mushimushi.autofix',
      name: 'Mushi Mushi Autofix Agent',
      description:
        'LLM-driven bug intake, classification, and autofix agent. Accepts user-reported bugs, ' +
        'classifies them via a two-stage pipeline, and ships fixes through sandboxed agentic workflows.',
      version: '0.2.0',
      publisher: { name: 'Mushi Mushi', url: 'https://mushimushi.dev' },
      documentation: 'https://docs.mushimushi.dev/api/agent-card',
      capabilities: {
        streaming: {
          protocol: 'agui',
          version: '0.1',
          endpoint: `${apiBase}/v1/admin/fixes/dispatch/:id/stream`,
        },
        sse: { sanitization: 'CVE-2026-29085' },
        mcp: { transport: 'http+sse', endpoint: mcpBase, version: '2026-03-26' },
        auth: {
          schemes: ['bearer', 'mushi-api-key'],
          discovery: `${apiBase}/v1/admin/auth/manifest`,
        },
        tasks: { spec: 'A2A-SEP-1686', endpoint: `${mcpBase}/tasks` },
      },
      skills: [
        {
          id: 'classify_report',
          description: 'Two-stage LLM classification of an incoming bug report.',
        },
        {
          id: 'dispatch_fix',
          description: 'Plan, draft, sandbox, and PR a fix for an existing report.',
        },
        {
          id: 'judge_fix',
          description: 'LLM-as-Judge evaluation of a generated fix vs. the originating report.',
        },
        {
          id: 'intelligence_report',
          description: 'Generate a privacy-preserving weekly bug intelligence digest.',
        },
      ],
      transports: {
        rest: { base: apiBase, openapi: `${apiBase}/openapi.json` },
        mcp: { base: mcpBase },
      },
      contact: {
        email: 'kensaurus@gmail.com',
        issues: 'https://github.com/kensaurus/mushi-mushi/issues',
      },
      license: { id: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      generatedAt: new Date().toISOString(),
    };
  }

  const AGENT_CARD_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    'Access-Control-Allow-Origin': '*',
  };

  app.get('/.well-known/agent-card', (c) => {
    return new Response(JSON.stringify(buildAgentCard(c.req.raw), null, 2), {
      status: 200,
      headers: AGENT_CARD_HEADERS,
    });
  });

  // Convenience alias so consumers hitting `/v1/agent-card` (no leading dot) get
  // the same payload — useful for proxies that strip dotfiles.
  app.get('/v1/agent-card', (c) => {
    return new Response(JSON.stringify(buildAgentCard(c.req.raw), null, 2), {
      status: 200,
      headers: AGENT_CARD_HEADERS,
    });
  });

  // Public auth-discovery manifest advertised by the A2A agent card under
  // `capabilities.auth.discovery`. Lets external agents enumerate the auth
  // schemes Mushi accepts without a JWT — they need this to know how to call
  // us in the first place. previously the agent card pointed
  // at a 404. Mirrors RFC 8414 (OAuth Authorization Server Metadata) shape
  // where it makes sense, but adapted to our two minimal schemes.
  app.get('/v1/admin/auth/manifest', (c) => {
    const url = new URL(c.req.raw.url);
    const apiBase = `${url.protocol}//${url.host}`;
    const manifest = {
      issuer: apiBase,
      schemes: [
        {
          id: 'bearer',
          type: 'bearer',
          description:
            'Supabase-issued JWT in the Authorization header. Use the project_id you own; ' +
            'enforced by row-level security and ownedProjectIds().',
          header: 'Authorization',
          format: 'Bearer <jwt>',
          token_endpoint: `${apiBase}/v1/admin/auth/token`,
          scopes: ['admin:reports', 'admin:fixes', 'admin:billing', 'admin:judge'],
        },
        {
          id: 'mushi-api-key',
          type: 'api_key',
          description:
            'Per-project ingestion key for the SDK. Restricted to /v1/reports and the ' +
            'public agent-card endpoints; cannot read admin data.',
          header: 'X-Mushi-Api-Key',
          format: 'mushi_<env>_<32-byte-hex>',
          rotation_endpoint: `${apiBase}/v1/admin/projects/:id/keys/rotate`,
          scopes: ['ingest:reports'],
        },
      ],
      documentation: 'https://docs.mushimushi.dev/api/auth',
      generatedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify(manifest, null, 2), {
      status: 200,
      headers: AGENT_CARD_HEADERS,
    });
  });

  // Token endpoint advertised by the auth manifest above.: previously
  // the manifest pointed at this URL but no Hono route existed, so any external
  // A2A agent following the discovery doc hit a 404 immediately.
  //
  // Two modes, both following RFC 6749 conventions so generic OAuth clients can
  // talk to us without bespoke code:
  //
  //   1. Refresh exchange — POST { grant_type: 'refresh_token', refresh_token }
  //      Returns { access_token, token_type, expires_in, refresh_token }.
  //      Backed by Supabase's refresh-session RPC so JWT rotation rules and
  //      lockouts are inherited from Auth instead of duplicated here.
  //
  //   2. Introspection — POST with `Authorization: Bearer <jwt>` and no body.
  //      Returns { active, sub, email, exp } — RFC 7662 shape minus claims an
  //      A2A agent doesn't need (aud, iss, scope are constant per cluster).
  //
  // Anything else returns 400 with a typed error so the agent can react.
  app.post('/v1/admin/auth/token', async (c) => {
    const db = getServiceClient();
    let body: Record<string, unknown> = {};
    // The introspection mode has no body, so an empty/invalid JSON parse is
    // expected — only fail loudly on a non-empty malformed payload.
    try {
      const raw = await c.req.text();
      if (raw.trim().length > 0) body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return c.json(
        { ok: false, error: { code: 'INVALID_JSON', message: 'Body must be valid JSON' } },
        400,
      );
    }

    const grantType = typeof body.grant_type === 'string' ? body.grant_type : null;

    if (grantType === 'refresh_token') {
      const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : null;
      if (!refreshToken) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'MISSING_REFRESH_TOKEN',
              message: 'refresh_token is required for grant_type=refresh_token',
            },
          },
          400,
        );
      }
      const { data, error } = await db.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) {
        return c.json(
          {
            ok: false,
            error: { code: 'INVALID_REFRESH_TOKEN', message: error?.message ?? 'Refresh failed' },
          },
          401,
        );
      }
      const session = data.session;
      return c.json({
        access_token: session.access_token,
        token_type: 'bearer',
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        refresh_token: session.refresh_token,
      });
    }

    if (grantType !== null) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'UNSUPPORTED_GRANT_TYPE',
            message: `grant_type '${grantType}' is not supported`,
          },
        },
        400,
      );
    }

    // Introspection fallback: no grant_type → require Bearer and report claims.
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'MISSING_AUTH',
            message: 'Provide grant_type or Authorization: Bearer <jwt>',
          },
        },
        401,
      );
    }
    const token = authHeader.slice('Bearer '.length);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error || !user) {
      return c.json({ active: false }, 200);
    }
    // Returning RFC 7662-shape claims minus `exp` — Supabase doesn't expose the
    // expiry from `auth.getUser()`, and callers can decode the JWT themselves
    // for that. `active` is the primary signal an A2A agent needs.
    return c.json({
      active: true,
      sub: user.id,
      email: user.email ?? null,
    });
  });
}
