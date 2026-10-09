import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import type { IntegrationKind } from '../../_shared/integration-probes.ts';
import { FIX_AGENT_KINDS, PLATFORM_KINDS, TICKET_INTEGRATION_KINDS } from '../../_shared/integration-probes.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue, listSyncDestinations } from '../../_shared/integrations.ts';
import { callerProjectIds, isProjectAdmin, requireProjectAdmin, resolveOwnedProject, resolveAccessibleOrg } from '../shared.ts';
import {
  parseSentryExtraProjectSlugs,
  validatePlatformBody,
  validateRoutingConfig,
} from '../../_shared/integration-validation.ts';
import { fieldsSharedAcrossApps, platformCardValues } from '../../_shared/platform-config.ts';
import { removePlatformKeys, type PlatformKeyStore } from '../../_shared/platform-key-removal.ts';
import { extractInboundTraceparent } from '../../_shared/trace.ts';
import { log } from '../../_shared/logger.ts';
import { vaultRoutingSecrets } from '../../_shared/routing-secrets.ts';
import { resolveEffectivePlatformSettings } from '../../_shared/integration-settings.ts';
import { classifyPlatformConnection } from '../../_shared/setup-signals.ts';
import { getMushiClaudeFixWorkflowYaml, MUSHI_CLAUDE_GITHUB_SECRETS } from '../../_shared/mushi-claude-workflow.ts';
import { resolveCursorApiKey } from '../../_shared/agent-adapters.ts';
import { CursorApiError, listCursorModelsV1 } from '../../_shared/cursor-cloud.ts';

export function registerIntegrationsRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // PHASE 5: INTEGRATIONS, PLUGINS, SYNTHETIC, INTELLIGENCE
  // ============================================================

  app.get('/v1/admin/integrations', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { integrations: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const { data } = await db
      .from('project_integrations')
      .select('id, project_id, integration_type, config, is_active, last_synced_at, created_at')
      .eq('project_id', project.id)
      .limit(50);

    // Routing destination configs hold secrets (API tokens, signing keys). The
    // UI only needs to know which fields are set, so we mask anything that
    // looks token-shaped before returning. Same heuristic as the platform GET.
    const maskRoutingConfig = (cfg: Record<string, unknown> | null): Record<string, unknown> => {
      if (!cfg || typeof cfg !== 'object') return {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cfg)) {
        if (v == null) {
          out[k] = null;
          continue;
        }
        const lower = k.toLowerCase();
        const looksSensitive =
          lower.endsWith('token') ||
          lower.endsWith('apikey') ||
          lower.endsWith('secret') ||
          lower.endsWith('key') ||
          lower === 'routingkey';
        if (looksSensitive && typeof v === 'string') {
          // A Vault ref says nothing about the token; show that one is set.
          out[k] = v.startsWith('vault://') ? '…****' : v.length > 4 ? `…${v.slice(-4)}` : '****';
        } else {
          out[k] = v;
        }
      }
      return out;
    };

    const integrations = (data ?? []).map((row) => ({
      ...row,
      config: maskRoutingConfig(row.config as Record<string, unknown> | null),
    }));
    // Where POST /v1/admin/integrations/sync/:reportId would push a report:
    // the active rows above plus Linear connected from the console, which has
    // no project_integrations row (same loader as the sync).
    const syncDestinations = await listSyncDestinations(db, project.id as string);
    return c.json({ ok: true, data: { integrations, syncDestinations } });
  });

  app.post('/v1/admin/integrations', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as {
      type: string;
      config: Record<string, unknown>;
      isActive?: boolean;
    };
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;
    if (typeof body.type !== 'string' || !/^[a-z_]{2,40}$/.test(body.type)) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } }, 400);
    }
    const invalid = validateRoutingConfig(body.type, body.config ?? {});
    if (invalid) return c.json({ ok: false, error: invalid }, 400);

    // Pull existing config so we can preserve secret fields the UI re-sent as
    // masked placeholders (e.g. "…abcd"). Without this, re-saving from the
    // editor without retyping a token would silently nuke it.
    const { data: existing } = await db
      .from('project_integrations')
      .select('config')
      .eq('project_id', project.id)
      .eq('integration_type', body.type)
      .maybeSingle();
    const prev = (existing?.config ?? {}) as Record<string, unknown>;

    const merged: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(body.config ?? {})) {
      if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue;
      merged[k] = v === '' ? null : v;
    }

    // Credentials go to Vault; the row keeps `vault://` refs only.
    let stored: Record<string, unknown>;
    try {
      stored = await vaultRoutingSecrets(db, project.id as string, body.type, merged);
    } catch (err) {
      log.error('routing secret vault write failed', { type: body.type, err: err instanceof Error ? err.message : String(err) });
      return c.json(
        { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: 'Mushi could not store the token safely. Nothing was saved; try again in a moment.' } },
        500,
      );
    }
    const { error } = await db.from('project_integrations').upsert(
      {
        project_id: project.id,
        integration_type: body.type,
        config: stored,
        is_active: body.isActive ?? true,
      },
      { onConflict: 'project_id,integration_type' },
    );

    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(db, project.id, userId, 'settings.updated', 'integration', undefined, {
      type: body.type,
    });
    return c.json({ ok: true });
  });

  // DELETE a routing destination (Jira/Linear/GitHub Issues/PagerDuty) so the
  // CRUD editor on IntegrationsPage can fully unwire a target without leaving
  // stale rows. Auditable; owner/admin only, like the POST that created it.
  app.delete('/v1/admin/integrations/:type', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const integrationType = c.req.param('type')!;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;

    const { error } = await db
      .from('project_integrations')
      .delete()
      .eq('project_id', project.id)
      .eq('integration_type', integrationType);

    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(db, project.id, userId, 'settings.deleted', 'integration', undefined, {
      type: integrationType,
    });
    return c.json({ ok: true });
  });

  // Per-project inbound webhook receipts — powers the "last inbound delivery"
  // proof line on integration cards (Sentry today). Answers "did my alert
  // actually arrive?" without leaving the console.
  app.get('/v1/admin/integrations/inbound-deliveries', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const source = c.req.query('source') ?? 'sentry';
    if (!/^[a-z_]{2,32}$/.test(source)) {
      return c.json({ ok: false, error: { code: 'BAD_SOURCE', message: 'Invalid source' } }, 400);
    }
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { deliveries: [] } });
    }
    const { data } = await db
      .from('webhook_audit_log')
      .select('outcome, response_status, error_message, created_at, project_id')
      .eq('webhook_source', source)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(5);
    return c.json({ ok: true, data: { deliveries: data ?? [] } });
  });

  app.get('/v1/admin/integrations/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: {
            hasAnyProject: false,
            projectId: null,
            projectName: null,
            platformTotal: 3,
            platformConnected: 0,
            platformHealthy: 0,
            platformDown: 0,
            routingActive: 0,
            routingPaused: 0,
            routingTotal: 0,
            lastProbeAt: null,
            topPriority: 'no_project',
            topPriorityLabel: 'Create a project first — integrations are scoped per app.',
            topPriorityTo: '/projects',
          },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const requiredByKind: Record<string, string[]> = {
      sentry: ['sentry_org_slug', 'sentry_auth_token_ref'],
      langfuse: ['langfuse_host', 'langfuse_public_key_ref', 'langfuse_secret_key_ref'],
      github: ['github_repo_url', 'github_installation_token_ref'],
    };
    const platformKinds = Object.keys(requiredByKind);

    // Use the effective resolver so inherited org credentials count as connected.
    const [
      { settings: effectiveSettings, sourceByField },
      { data: routingRows },
      { data: probes },
      { data: sentryDelivered },
    ] =
      await Promise.all([
        resolveEffectivePlatformSettings(db, project.id as string),
        db
          .from('project_integrations')
          .select('integration_type, is_active')
          .eq('project_id', project.id),
        db
          .from('integration_health_history')
          .select('kind, status, checked_at')
          .eq('project_id', project.id)
          .order('checked_at', { ascending: false })
          .limit(50),
        // Has any Sentry alert ever reached this project? The API probe only
        // proves the token; the inbound webhook is the other half.
        db
          .from('webhook_audit_log')
          .select('id')
          .eq('project_id', project.id)
          .eq('webhook_source', 'sentry')
          .eq('outcome', 'accepted')
          .limit(1),
      ]);

    const row = (effectiveSettings ?? {}) as Record<string, unknown>;
    // Also collect env-backed fields so we count them as connected in stats.
    const envBackedFields = new Set(
      Object.entries(sourceByField)
        .filter(([, src]) => src === 'env')
        .map(([f]) => f),
    );
    let platformConnected = 0;
    let platformHealthy = 0;
    let platformDown = 0;
    const attentionKinds: string[] = [];
    const downKinds: string[] = [];

    const latestProbeByKind = new Map<string, { status: string; checked_at: string }>();
    for (const p of probes ?? []) {
      if (!latestProbeByKind.has(p.kind as string)) {
        latestProbeByKind.set(p.kind as string, {
          status: p.status as string,
          checked_at: p.checked_at as string,
        });
      }
    }

    const missingKinds: string[] = [];
    for (const kind of platformKinds) {
      const required = requiredByKind[kind] ?? [];
      const connected = required.every(
        (f) => (row[f] != null && row[f] !== '') || envBackedFields.has(f),
      );
      if (!connected) {
        missingKinds.push(kind);
        continue;
      }
      platformConnected += 1;
      const probe = latestProbeByKind.get(kind);
      const verdict = classifyPlatformConnection({
        probeStatus: probe?.status,
        probeCheckedAt: probe?.checked_at,
        needsInbound: kind === 'sentry',
        inboundAccepted: (sentryDelivered ?? []).length > 0,
      });
      if (verdict === 'working') platformHealthy += 1;
      else if (verdict === 'down') {
        platformDown += 1;
        downKinds.push(kind);
      } else attentionKinds.push(kind);
    }

    // Fix agents (Cursor Cloud, Claude Code) have cards on the same page, so a
    // failing or unproven agent must show in the banner too. They count toward
    // down/attention only: picking one agent is enough, so an unconfigured
    // agent never reads as "missing credentials".
    const fixAgentRequired: Record<string, string> = {
      cursor_cloud: 'cursor_api_key_ref',
      claude_code_agent: 'claude_api_key_ref',
    };
    for (const kind of FIX_AGENT_KINDS as string[]) {
      const field = fixAgentRequired[kind];
      if (!field) continue;
      const configured = (row[field] != null && row[field] !== '') || envBackedFields.has(field);
      if (!configured) continue;
      const probe = latestProbeByKind.get(kind);
      const verdict = classifyPlatformConnection({
        probeStatus: probe?.status,
        probeCheckedAt: probe?.checked_at,
      });
      if (verdict === 'down') {
        platformDown += 1;
        downKinds.push(kind);
      } else if (verdict === 'attention') attentionKinds.push(kind);
    }
    const platformAttention = attentionKinds.length;

    const routing = routingRows ?? [];
    const routingActive = routing.filter((r) => r.is_active).length;
    const routingPaused = routing.filter((r) => !r.is_active).length;

    const pid = project.id as string;
    // resolveOwnedProject selects `name` (not `project_name`); reading the
    // wrong key made projectName always null in the integrations widget.
    const pname = (project.name as string | null) ?? null;
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`;

    let topPriority: 'platform_down' | 'incomplete' | 'attention' | 'empty' | 'healthy' = 'healthy';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    const KIND_NAMES: Record<string, string> = {
      sentry: 'Sentry',
      langfuse: 'Langfuse',
      github: 'GitHub',
      cursor_cloud: 'Cursor Cloud',
      claude_code_agent: 'Claude Code',
    };
    const nameList = (kinds: string[]) => kinds.map((k) => KIND_NAMES[k] ?? k).join(', ');
    if (platformDown > 0) {
      topPriority = 'platform_down';
      topPriorityLabel = `${nameList(downKinds)} ${platformDown === 1 ? 'is' : 'are'} failing — the card below says why and has the fix.`;
      topPriorityTo = `${scoped('/integrations/config')}#platform-card-${downKinds[0]}`;
    } else if (platformConnected === 0 && routingActive === 0) {
      // Nothing configured at all — must precede the `incomplete` check below,
      // which would otherwise always swallow this case (0 < platformKinds.length).
      topPriority = 'empty';
      topPriorityLabel =
        'Start with GitHub so fix-worker can open draft PRs, then add Sentry or Langfuse for richer bug context.';
      // Every CTA lands on the card it names: a bare /integrations/config
      // link from this page reloaded the view the user was already on.
      topPriorityTo = `${scoped('/integrations/config')}#platform-card-github`;
    } else if (platformConnected < platformKinds.length) {
      const missing = platformKinds.length - platformConnected;
      topPriority = 'incomplete';
      topPriorityLabel = `${missing} of ${platformKinds.length} core tools still need credentials — GitHub is required before auto-fix PRs can ship.`;
      const firstMissing = missingKinds.includes('github') ? 'github' : missingKinds[0];
      topPriorityTo = `${scoped('/integrations/config')}#platform-card-${firstMissing}`;
    } else if (platformAttention > 0) {
      topPriority = 'attention';
      topPriorityLabel = `${nameList(attentionKinds)} ${platformAttention === 1 ? 'needs' : 'need'} attention — each card below says what and has the fix.`;
      topPriorityTo = `${scoped('/integrations/config')}#platform-card-${attentionKinds[0]}`;
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${platformConnected}/${platformKinds.length} platform tools connected · ${routingActive} routing rule${routingActive === 1 ? '' : 's'} active`;
      // The healthy banner's CTA is "Check repo index".
      topPriorityTo = `${scoped('/integrations/config')}#integrations-codebase`;
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: pname,
        platformTotal: platformKinds.length,
        platformConnected,
        platformHealthy,
        platformDown,
        platformAttention,
        routingActive,
        routingPaused,
        routingTotal: routing.length,
        lastProbeAt: (probes?.[0]?.checked_at as string | null) ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  // ----- Platform integrations (Sentry / Langfuse / GitHub) ---------------
  // These are V5.3 §2.18 first-party integrations. Unlike Jira/Linear (which
  // live in project_integrations as routing destinations), Sentry/Langfuse/GH
  // are observability/code surfaces that the LLM pipeline + fix-worker need
  // directly. They live in project_settings so the existing readers
  // (resolveLlmKey, fix-worker, fast-filter) pick them up without joins.

  const PLATFORM_KIND_FIELDS: Record<string, string[]> = {
    sentry: [
      'sentry_org_slug',
      'sentry_project_slug',
      'sentry_auth_token_ref',
      'sentry_dsn',
      'sentry_seer_enabled',
      'sentry_webhook_secret',
      'sentry_consume_user_feedback',
      'sentry_auto_import',
    ],
    langfuse: ['langfuse_host', 'langfuse_public_key_ref', 'langfuse_secret_key_ref'],
    github: [
      'github_repo_url',
      'github_default_branch',
      'github_installation_token_ref',
      'github_webhook_secret',
      'github_deploy_key',
    ],
    cursor_cloud: [
      'cursor_api_key_ref',
      'cursor_default_model',
      'cursor_auto_create_pr',
      'cursor_max_iterations',
    ],
    // The three settings the card renders next to the key. They were missing
    // here, so a save that changed only them hit NO_FIELDS and a save with
    // the key silently dropped them.
    claude_code_agent: ['claude_api_key_ref', 'claude_default_model', 'claude_workflow_event', 'claude_default_branch'],
    // Linear: vault-backed credentials replacing project_integrations.config for 'linear'
    linear: [
      'linear_api_key_ref',
      'linear_access_token_ref',
      'linear_workspace_name',
      'linear_team_id',
      'linear_webhook_secret_ref',
      'linear_actor_token_ref',
    ],
  };

  const PLATFORM_API_KINDS = [
  ...PLATFORM_KINDS,
  ...FIX_AGENT_KINDS,
  ...TICKET_INTEGRATION_KINDS,
] as IntegrationKind[];

  app.get('/v1/admin/integrations/platform', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { platform: null, sourceByField: {} } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    // Use the effective resolver so org-inherited and env-backed fields are
    // reflected in the card's "configured" state and inheritance badges.
    // Fields the resolver does not track come from the project row; select(*)
    // so a column a pending migration adds is simply absent, not an error.
    const [{ settings: effectiveSettings, sourceByField, organizationId }, rawRowRes] = await Promise.all([
      resolveEffectivePlatformSettings(db, project.id as string),
      db.from('project_settings').select('*').eq('project_id', project.id).maybeSingle(),
    ]);
    // Without the row every untracked card field (Sentry slug, DSN, toggles,
    // extra slugs) would come back null and the card would show it unset.
    // select('*') does not fail on a column a pending migration adds, so an
    // error here is a real read failure: say so instead of serving nulls.
    if (rawRowRes.error) {
      log.error('platform GET: project_settings row unreadable', { projectId: project.id, err: rawRowRes.error.message });
      return c.json(
        { ok: false, error: { code: 'SETTINGS_UNREADABLE', message: "Could not read this project's integration settings. Try again." } },
        500,
      );
    }
    const projectRow = (rawRowRes.data ?? null) as Record<string, unknown> | null;

    // Mask secret-shaped values; we only return whether a credential is set,
    // never the value itself. The UI shows "configured" badges, not secrets.
    const maskField = (k: string, v: unknown): unknown => {
      if (v == null) return null;
      if (
        k.endsWith('_ref') ||
        k.endsWith('_secret') ||
        k.endsWith('_token') ||
        k.endsWith('_key')
      ) {
        return typeof v === 'string' ? `…${v.slice(-4)}` : '****';
      }
      return v;
    };

    // Only iterate kinds we actually have platform fields for. INTEGRATION_KINDS
    // includes LLM providers (anthropic/openai) which are BYOK rather than
    // platform integrations — those live in `llm_byok_keys`, not project_settings,
    // and iterating them here would try to read `undefined` as an array and 500.
    const platform: Record<string, Record<string, unknown>> = {};
    const platformKinds = Object.keys(PLATFORM_KIND_FIELDS) as Array<
      keyof typeof PLATFORM_KIND_FIELDS
    >;
    for (const kind of platformKinds) {
      const values = platformCardValues(
        kind,
        PLATFORM_KIND_FIELDS[kind],
        effectiveSettings as unknown as Record<string, unknown>,
        sourceByField,
        projectRow,
      );
      platform[kind] = {};
      for (const [f, v] of Object.entries(values)) platform[kind][f] = maskField(f, v);
    }

    // canManage mirrors requireProjectAdmin on the PUT / apply / routing /
    // Linear writes, so the console can disable those controls up front.
    return c.json({ ok: true, data: { platform, sourceByField, organizationId, canManage: isProjectAdmin(project) } });
  });

  // Fields that should be auto-vaulted: when the user submits a raw secret
  // value, write it to Supabase Vault and persist `vault://<name>` instead.
  // This matches the BYOK pattern and prevents secrets from sitting plaintext
  // in project_settings.
  const VAULTED_FIELDS_BY_KIND: Record<string, string[]> = {
    sentry: ['sentry_auth_token_ref', 'sentry_webhook_secret'],
    langfuse: ['langfuse_public_key_ref', 'langfuse_secret_key_ref'],
    github: ['github_installation_token_ref', 'github_webhook_secret', 'github_deploy_key'],
    cursor_cloud: ['cursor_api_key_ref'],
    claude_code_agent: ['claude_api_key_ref'],
    linear: [
      'linear_api_key_ref',
      'linear_access_token_ref',
      'linear_refresh_token_ref',
      'linear_webhook_secret_ref',
      'linear_actor_token_ref',
    ],
  };

  app.put('/v1/admin/integrations/platform/:kind', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind')! as IntegrationKind;
    if (!PLATFORM_API_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;

    const invalid = validatePlatformBody(body);
    if (invalid) return c.json({ ok: false, error: invalid }, 400);

    const allowed = PLATFORM_KIND_FIELDS[kind];
    // anthropic / openai are probe kinds (BYOK lives in Settings → API keys),
    // not cards with fields here; iterating `undefined` below used to 500.
    if (!allowed) {
      return c.json(
        { ok: false, error: { code: 'BAD_KIND', message: `"${kind}" keys are managed in Settings → API keys, not here.` } },
        400,
      );
    }
    const vaulted = new Set(VAULTED_FIELDS_BY_KIND[kind] ?? []);
    // Only persist whitelisted fields. Empty strings clear the value (so the
    // UI can offer a "remove" affordance without a separate DELETE endpoint).
    // Masked values from GET ("…abcd") are silently ignored so a partial form
    // submit doesn't replace a real key with a masked one.
    const updates: Record<string, unknown> = { project_id: project.id };
    // Project-only list field (PROJECT_LIST_FIELDS_BY_KIND): a validated
    // array, never vaulted, never copied to other projects.
    if (kind === 'sentry' && 'sentry_extra_project_slugs' in body) {
      const parsed = parseSentryExtraProjectSlugs(body.sentry_extra_project_slugs);
      if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
      updates.sentry_extra_project_slugs = parsed.slugs;
    }
    for (const k of allowed) {
      if (!(k in body)) continue;
      const v = body[k];
      if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue;

      if (v === '' || v === null) {
        updates[k] = null;
        continue;
      }

      if (vaulted.has(k) && typeof v === 'string') {
        // Auto-vault: write the raw secret to Supabase Vault and store the ref.
        // Never persist the raw value: a failed Vault write fails the request.
        const secretName = `mushi/integration/${project.id}/${kind}/${k}`;
        const { error: vaultErr } = await db.rpc('vault_store_secret', {
          secret_name: secretName,
          secret_value: v,
        });
        if (vaultErr) {
          log.error('vault_store_secret failed for integration secret', {
            scope: 'integrations',
            kind,
            field: k,
            err: vaultErr.message,
          });
          return c.json(
            { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: `Could not store ${k} securely. Retry in a moment.` } },
            500,
          );
        }
        updates[k] = `vault://${secretName}`;
      } else {
        updates[k] = v;
      }
    }

    if (Object.keys(updates).length === 1) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_FIELDS',
            message: 'No editable fields supplied for this integration kind.',
          },
        },
        400,
      );
    }

    const { error } = await db
      .from('project_settings')
      .upsert(updates, { onConflict: 'project_id' });

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    }
    await logAudit(db, project.id, userId, 'settings.updated', 'integration_platform', undefined, {
      kind,
    });
    return c.json({ ok: true });
  });

  // DELETE /v1/admin/integrations/platform/:kind/key — the card's "Remove key".
  // Clears every secret field this project stores for :kind (the vaulted
  // ones: tokens, keys, webhook secrets) and deletes the project's own Vault
  // secrets. Plain settings (repo URL, org slug, model) stay. Org defaults
  // and env values are not touched, so the card may still read as connected
  // through them. Same owner/admin gate as the Save that wrote the key:
  // a member cannot set a key, so a member cannot remove one either.
  // Linear has its own Disconnect (OAuth + webhook teardown) on its card.
  const REMOVABLE_KEY_KINDS = ['sentry', 'langfuse', 'github', 'cursor_cloud', 'claude_code_agent'];
  app.delete('/v1/admin/integrations/platform/:kind/key', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind')!;
    if (!REMOVABLE_KEY_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND', message: `"${kind}" has no removable key here.` } }, 400);
    }
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;
    const projectId = project.id as string;

    const store: PlatformKeyStore = {
      readFields: async (fields) => {
        const { data, error } = await db
          .from('project_settings')
          .select(fields.join(', '))
          .eq('project_id', projectId)
          .maybeSingle();
        return { row: (data ?? null) as Record<string, unknown> | null, error: error?.message ?? null };
      },
      clearFields: async (fields) => {
        const patch = Object.fromEntries(fields.map((f) => [f, null]));
        const { error } = await db.from('project_settings').update(patch).eq('project_id', projectId);
        return error?.message ?? null;
      },
      refUsedElsewhere: async (field, ref) => {
        const { data, error } = await db
          .from('project_settings')
          .select('project_id')
          .eq(field, ref)
          .neq('project_id', projectId)
          .limit(1);
        // Unknown = shared: never delete a secret we could not prove is ours alone.
        return Boolean(error) || (data ?? []).length > 0;
      },
      deleteVaultSecret: async (name) => {
        const { error } = await db.rpc('vault_delete_secret', { secret_name: name });
        if (error) {
          log.warn('vault_delete_secret failed for integration key (non-fatal)', { kind, err: error.message });
        }
        return error?.message ?? null;
      },
    };

    const removal = await removePlatformKeys(store, {
      projectId,
      kind,
      fields: VAULTED_FIELDS_BY_KIND[kind] ?? [],
    });
    if (removal.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'Could not remove the key. Nothing was changed; try again.' } }, 500);
    }
    await logAudit(db, projectId, userId, 'settings.deleted', 'integration_platform', undefined, {
      kind,
      cleared: removal.cleared,
      vaultSecretsDeleted: removal.deletedSecrets.length,
      vaultSecretsKept: removal.keptSecrets.length,
    });
    return c.json({ ok: true, data: { cleared: removal.cleared } });
  });

  // ----- Org-level integration defaults (org owner / admin only) -----------
  // GET  /v1/admin/org/integrations/platform/:kind  — read org defaults
  // PUT  /v1/admin/org/integrations/platform/:kind  — write org defaults (auto-vault)
  //
  // These endpoints mirror the per-project GET/PUT above but target the
  // organization_integration_settings table. The caller must pass
  // X-Mushi-Org-Id (JWT) or own a project in the org (API key).

  app.get('/v1/admin/org/integrations/platform/:kind', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind')! as IntegrationKind;
    if (!PLATFORM_API_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }
    const db = getServiceClient();
    const orgResult = await resolveAccessibleOrg(c, db, userId);
    if (!orgResult.ok) return orgResult.response;
    const { organizationId } = orgResult;

    const fields = PLATFORM_KIND_FIELDS[kind] ?? [];
    const { data: orgRow } = await db
      .from('organization_integration_settings')
      .select(fields.join(', '))
      .eq('organization_id', organizationId)
      .maybeSingle();

    const maskField = (k: string, v: unknown): unknown => {
      if (v == null) return null;
      if (k.endsWith('_ref') || k.endsWith('_secret') || k.endsWith('_token') || k.endsWith('_key')) {
        return typeof v === 'string' ? `…${v.slice(-4)}` : '****';
      }
      return v;
    };

    const config: Record<string, unknown> = {};
    for (const f of fields) {
      config[f] = maskField(f, (orgRow as Record<string, unknown> | null)?.[f]);
    }

    return c.json({ ok: true, data: { config, organizationId } });
  });

  app.put('/v1/admin/org/integrations/platform/:kind', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind')! as IntegrationKind;
    if (!PLATFORM_API_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const db = getServiceClient();
    const orgResult = await resolveAccessibleOrg(c, db, userId);
    if (!orgResult.ok) return orgResult.response;
    const { organizationId, role } = orgResult;

    // Only org owners and admins may update org defaults.
    if (role !== 'owner' && role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Only org owners and admins can set org-level integration defaults.' } },
        403,
      );
    }

    const invalid = validatePlatformBody(body);
    if (invalid) return c.json({ ok: false, error: invalid }, 400);

    const allowed = PLATFORM_KIND_FIELDS[kind];
    // anthropic / openai are probe kinds (BYOK lives in Settings → API keys),
    // not cards with fields here; iterating `undefined` below used to 500.
    if (!allowed) {
      return c.json(
        { ok: false, error: { code: 'BAD_KIND', message: `"${kind}" keys are managed in Settings → API keys, not here.` } },
        400,
      );
    }
    const vaulted = new Set(VAULTED_FIELDS_BY_KIND[kind] ?? []);
    const updates: Record<string, unknown> = { organization_id: organizationId };

    for (const k of allowed) {
      if (!(k in body)) continue;
      const v = body[k];
      if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue;

      if (v === '' || v === null) {
        updates[k] = null;
        continue;
      }

      if (vaulted.has(k) && typeof v === 'string') {
        const secretName = `mushi/org-integration/${organizationId}/${kind}/${k}`;
        const { error: vaultErr } = await db.rpc('vault_store_secret', {
          secret_name: secretName,
          secret_value: v,
        });
        if (vaultErr) {
          log.error('vault_store_secret failed for org integration secret', {
            scope: 'org-integrations',
            kind,
            field: k,
            err: vaultErr.message,
          });
          return c.json(
            { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: `Could not store ${k} securely. Retry in a moment.` } },
            500,
          );
        }
        updates[k] = `vault://${secretName}`;
      } else {
        updates[k] = v;
      }
    }

    if (Object.keys(updates).length === 1) {
      return c.json({ ok: false, error: { code: 'NO_FIELDS', message: 'No editable fields supplied.' } }, 400);
    }

    // Look up the first project in the org for audit logging (org-level actions
    // need a project_id FK for audit rows; use the lexicographically first one).
    const { data: anyProject } = await db
      .from('projects')
      .select('id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const auditProjectId = anyProject?.id as string | null;

    const { error } = await db
      .from('organization_integration_settings')
      .upsert(updates, { onConflict: 'organization_id' });

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    }
    if (auditProjectId) {
      await logAudit(db, auditProjectId, userId, 'settings.updated', 'org_integration_platform', undefined, { kind, organizationId });
    }
    return c.json({ ok: true });
  });

  // ----- Bulk "Apply to all projects" / "Copy to projects…" ---------------
  // POST /v1/admin/integrations/platform/:kind/apply
  //
  // Body: { target: 'org-all' | { projectIds: string[] } }
  //
  // Copies the caller's current project credentials for :kind into every
  // target project inside the same organization. Re-vaults per-project (so
  // each project gets its own vault entry). Owner-gated and audited.
  //
  // On success returns { ok: true, data: { applied: N, skipped: N, failed: N } }.

  app.post('/v1/admin/integrations/platform/:kind/apply', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind')! as IntegrationKind;
    if (!PLATFORM_API_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      target?: 'org-all' | { projectIds: string[] };
    };
    if (!body.target) {
      return c.json({ ok: false, error: { code: 'TARGET_REQUIRED', message: 'Provide target: "org-all" or { projectIds: [...] }' } }, 400);
    }

    const db = getServiceClient();
    // Source project (the one whose creds to copy).
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const forbidden = requireProjectAdmin(c, resolvedProject.project);
    if (forbidden) return forbidden;
    const sourceProjectId = resolvedProject.project.id as string;
    const orgId = resolvedProject.project.organization_id as string | null;

    if (!orgId) {
      return c.json({ ok: false, error: { code: 'NO_ORG', message: 'Project has no organization. Assign it to an org before using bulk-apply.' } }, 422);
    }

    // Read source credentials (raw, not masked). Fields that name the source
    // app (its Sentry project, DSN, repo) stay with it: copying them pointed
    // every target at the source app's Sentry project.
    const fields = fieldsSharedAcrossApps(kind, PLATFORM_KIND_FIELDS[kind] ?? []);
    const { data: sourceSettings } = await db
      .from('project_settings')
      .select(fields.join(', '))
      .eq('project_id', sourceProjectId)
      .maybeSingle();
    const sourceRow = (sourceSettings ?? {}) as Record<string, unknown>;

    // Determine target project IDs (also fetch names for the response summary).
    let targetProjectIds: string[];
    const projectNameById = new Map<string, string>();
    if (body.target === 'org-all') {
      const { data: orgProjects } = await db
        .from('projects')
        .select('id, name')
        .eq('organization_id', orgId);
      for (const p of orgProjects ?? []) { projectNameById.set((p as { id: string; name: string }).id, (p as { id: string; name: string }).name ?? ''); }
      targetProjectIds = (orgProjects ?? [])
        .map((p: { id: string; name: string }) => p.id)
        .filter((id: string) => id !== sourceProjectId);
    } else {
      // Validate requested IDs belong to this org.
      const { data: orgProjects } = await db
        .from('projects')
        .select('id, name')
        .eq('organization_id', orgId);
      for (const p of orgProjects ?? []) { projectNameById.set((p as { id: string; name: string }).id, (p as { id: string; name: string }).name ?? ''); }
      const orgProjectSet = new Set((orgProjects ?? []).map((p: { id: string }) => p.id));
      targetProjectIds = (body.target as { projectIds: string[] }).projectIds.filter(
        (id) => orgProjectSet.has(id) && id !== sourceProjectId,
      );
    }

    if (targetProjectIds.length === 0) {
      return c.json({ ok: true, data: { applied: 0, skipped: 0, failed: 0, message: 'No target projects.' } });
    }

    const vaulted = new Set(VAULTED_FIELDS_BY_KIND[kind] ?? []);
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    const appliedNames: string[] = [];

    for (const targetProjectId of targetProjectIds) {
      try {
        const updates: Record<string, unknown> = { project_id: targetProjectId };
        let hasAnyField = false;

        for (const k of fields) {
          const v = sourceRow[k];
          if (v == null || v === '') continue;
          hasAnyField = true;

          if (vaulted.has(k) && typeof v === 'string') {
            // If the source value is a vault ref, resolve it and re-vault under the target project's key.
            let rawValue = v;
            if (v.startsWith('vault://')) {
              const id = v.slice('vault://'.length);
              const { data: secret } = await db.rpc('vault_get_secret', { secret_id: id });
              rawValue = typeof secret === 'string' ? secret : v;
            }
            // Re-vault under the target project namespace.
            if (!rawValue.startsWith('vault://')) {
              const secretName = `mushi/integration/${targetProjectId}/${kind}/${k}`;
              const { error: vaultErr } = await db.rpc('vault_store_secret', {
                secret_name: secretName,
                secret_value: rawValue,
              });
              // Never copy a raw secret into another project's row.
              if (vaultErr) throw new Error(`vault_store_secret failed: ${vaultErr.message}`);
              updates[k] = `vault://${secretName}`;
            } else {
              updates[k] = rawValue;
            }
          } else {
            updates[k] = v;
          }
        }

        if (!hasAnyField) { skipped++; continue; }

        const { error: upsertErr } = await db
          .from('project_settings')
          .upsert(updates, { onConflict: 'project_id' });

        if (upsertErr) {
          log.warn('bulk-apply upsert failed', { targetProjectId, err: upsertErr.message });
          failed++;
        } else {
          applied++;
          // `??` alone would keep a stored empty-string name and render a blank
          // entry ("Projects: , Foo"); fall back to the id when the name is empty.
          const nm = projectNameById.get(targetProjectId);
          appliedNames.push(nm && nm.trim() ? nm : targetProjectId);
        }
      } catch (err) {
        log.warn('bulk-apply error for project', { targetProjectId, err: String(err) });
        failed++;
      }
    }

    await logAudit(db, sourceProjectId, userId, 'settings.updated', 'integration_bulk_apply', undefined, {
      kind,
      target: body.target,
      applied,
      skipped,
      failed,
    });

    return c.json({ ok: true, data: { applied, skipped, failed, projectNames: appliedNames.slice(0, 30) } });
  });

  // ── Cursor models for this project's key ──────────────────────────────────
  // GET /v1/models on Cursor: the ids the key may pass as model.id, with the
  // params (effort, context, fast) and variants each accepts. Read-only.
  app.get('/v1/admin/integrations/cursor/models', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project selected' } }, 400),
    });
    if ('response' in resolvedProject) return resolvedProject.response;

    const apiKey = await resolveCursorApiKey(db, resolvedProject.project.id);
    if (!apiKey) {
      return c.json({ ok: false, error: { code: 'NO_CURSOR_KEY', message: 'Add a Cursor API key under Settings → AI keys first.' } }, 400);
    }
    try {
      const models = await listCursorModelsV1({ apiKey });
      return c.json({ ok: true, data: { models } });
    } catch (err) {
      const status = err instanceof CursorApiError ? err.status : 0;
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'CURSOR_MODELS_FAILED', message: `Cursor did not return its models (${status || 'network'}): ${message.slice(0, 200)}` } }, 502);
    }
  });

  // ── Claude Code Agent BYOK setup instructions ──────────────────────────────
  // Returns the workflow YAML + required GitHub secrets so the operator can
  // copy them into their repo. No secrets are written here — pure read.
  app.get('/v1/admin/integrations/claude-code-agent/setup', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project selected' } }, 400),
    });
    if ('response' in resolvedProject) return resolvedProject.response;

    const mushiSupabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // Render the YAML for the event this project is set to send.
    const { data: claudeRow } = await db
      .from('project_settings')
      .select('claude_workflow_event')
      .eq('project_id', resolvedProject.project.id)
      .maybeSingle();
    const eventType = (claudeRow as { claude_workflow_event?: string | null } | null)?.claude_workflow_event ?? null;

    return c.json({
      ok: true,
      data: {
        workflowYaml: getMushiClaudeFixWorkflowYaml(eventType),
        workflowPath: '.github/workflows/mushi-claude-fix.yml',
        githubSecrets: MUSHI_CLAUDE_GITHUB_SECRETS,
        mushiSupabaseUrl,
        serviceRoleHint:
          'Hosted Mushi cannot receive the run result from this workflow yet: the draft PR opens in your repo, but its status is not written back to the Fix card. On a self-hosted Mushi, MUSHI_SERVICE_ROLE_KEY enables the write-back and never leaves your GitHub Actions environment.',
      },
    });
  });

  app.post('/v1/admin/integrations/sync/:reportId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const reportId = c.req.param('reportId')!;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    const { data: report } = await db
      .from('reports')
      .select('id, project_id, summary, description, category, severity, component, metadata')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .single();
    if (!report)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    // Propagate any stored traceparent (set at ingest time) so BYOK API calls
    // (Jira, Linear, GitHub, PagerDuty) share the same distributed trace.
    const storedTraceparent =
      typeof (report.metadata as Record<string, unknown> | null)?.traceparent === 'string'
        ? ((report.metadata as Record<string, unknown>).traceparent as string)
        : extractInboundTraceparent(c.req.header('traceparent'));

    const results = await createExternalIssue(
      db,
      report.project_id,
      {
        id: report.id,
        summary: report.summary ?? '',
        description: report.description ?? '',
        category: report.category,
        severity: report.severity ?? 'medium',
        component: report.component,
      },
      storedTraceparent ?? undefined,
    );

    await logAudit(db, report.project_id, userId, 'integration.synced', 'report', reportId, {
      results,
    });
    return c.json({ ok: true, data: { synced: results } });
  });

  // ── Linear OAuth authorize ─────────────────────────────────────────────────
  //
  // GET /v1/admin/linear-oauth/authorize
  //
  // Initiates the Linear OAuth 2.0 Authorization Code flow. Returns the Linear
  // authorize URL as JSON; the console fetches it (with a Bearer token via
  // apiFetch) and then sets window.location.href to it.
  //
  // Why JSON, not a 302: this route is jwtAuth-gated, but the console's
  // "Connect" button is a full-page navigation which cannot attach an
  // Authorization header — so a top-level GET here would 401 before Linear is
  // ever reached. Returning the URL over an authenticated fetch and navigating
  // client-side is the correct SPA + bearer-token OAuth-initiation pattern.
  //
  // Requires jwtAuth + project ownership (same as other admin integration routes).

  app.get('/v1/admin/linear-oauth/authorize', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project selected' } }, 400),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;

    const clientId = Deno.env.get('LINEAR_OAUTH_CLIENT_ID');
    if (!clientId) {
      return c.json({
        ok: false,
        error: { code: 'MISCONFIGURED', message: 'Linear OAuth not configured. Contact support.' },
      }, 503);
    }

    // Mint a one-time CSRF nonce
    const nonce = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const { error: insertError } = await db
      .from('linear_oauth_states')
      .insert({ project_id: project.id, user_id: userId, nonce });

    if (insertError) {
      log.error('Failed to insert linear_oauth_states', { err: insertError.message });
      return c.json({ ok: false, error: { code: 'INTERNAL', message: 'Failed to create auth state' } }, 500);
    }

    const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/linear-oauth-callback`;
    const authUrl = new URL('https://linear.app/oauth/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('scope', 'read write app:assignable app:mentionable');
    authUrl.searchParams.set('state', nonce);
    authUrl.searchParams.set('actor', 'app');
    authUrl.searchParams.set('response_type', 'code');

    return c.json({ ok: true, data: { url: authUrl.toString() } });
  });

  // ── Linear disconnect ──────────────────────────────────────────────────────
  //
  // DELETE /v1/admin/linear-oauth/disconnect
  //
  // Clears all vault-backed Linear credentials for the active project.

  app.delete('/v1/admin/linear-oauth/disconnect', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project selected' } }, 400),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const forbidden = requireProjectAdmin(c, project);
    if (forbidden) return forbidden;

    const { error } = await db
      .from('project_settings')
      .update({
        linear_access_token_ref: null,
        linear_refresh_token_ref: null,
        linear_api_key_ref: null,
        linear_workspace_name: null,
        linear_team_id: null,
        linear_webhook_secret_ref: null,
        linear_actor_token_ref: null,
      })
      .eq('project_id', project.id);

    if (error) {
      return c.json({ ok: false, error: { code: 'INTERNAL', message: 'Disconnect failed' } }, 500);
    }

    await logAudit(db, project.id, userId, 'integration.synced', 'project', project.id, { action: 'disconnected', kind: 'linear' });
    return c.json({ ok: true, data: { disconnected: 'linear' } });
  });

}
