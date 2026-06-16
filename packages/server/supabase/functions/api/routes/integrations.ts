import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import type { IntegrationKind } from '../../_shared/integration-probes.ts';
import { FIX_AGENT_KINDS, PLATFORM_KINDS } from '../../_shared/integration-probes.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { callerProjectIds, resolveOwnedProject } from '../shared.ts';
import { extractInboundTraceparent } from '../../_shared/trace.ts';
import { log } from '../../_shared/logger.ts';

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
          out[k] = v.length > 4 ? `…${v.slice(-4)}` : '****';
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
    return c.json({ ok: true, data: { integrations } });
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

    const { error } = await db.from('project_integrations').upsert(
      {
        project_id: project.id,
        integration_type: body.type,
        config: merged,
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
  // stale rows. Auditable; only the project owner can delete their own rows.
  app.delete('/v1/admin/integrations/:type', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const integrationType = c.req.param('type')!;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

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

  app.get('/v1/admin/integrations/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: {
            platformTotal: 3,
            platformConnected: 0,
            platformHealthy: 0,
            platformDown: 0,
            routingActive: 0,
            routingPaused: 0,
            routingTotal: 0,
            lastProbeAt: null,
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
    const allFields = [
      'sentry_org_slug',
      'sentry_auth_token_ref',
      'langfuse_host',
      'langfuse_public_key_ref',
      'langfuse_secret_key_ref',
      'github_repo_url',
      'github_installation_token_ref',
    ].join(', ');

    const [{ data: settings }, { data: routingRows }, { data: probes }] = await Promise.all([
      db.from('project_settings').select(allFields).eq('project_id', project.id).maybeSingle(),
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
    ]);

    const row = (settings ?? {}) as Record<string, unknown>;
    let platformConnected = 0;
    let platformHealthy = 0;
    let platformDown = 0;

    const latestProbeByKind = new Map<string, { status: string; checked_at: string }>();
    for (const p of probes ?? []) {
      if (!latestProbeByKind.has(p.kind as string)) {
        latestProbeByKind.set(p.kind as string, {
          status: p.status as string,
          checked_at: p.checked_at as string,
        });
      }
    }

    for (const kind of platformKinds) {
      const required = requiredByKind[kind] ?? [];
      const connected = required.every((f) => row[f] != null && row[f] !== '');
      if (!connected) continue;
      platformConnected += 1;
      const probe = latestProbeByKind.get(kind);
      if (probe?.status === 'ok') platformHealthy += 1;
      else if (probe?.status === 'down' || probe?.status === 'degraded') platformDown += 1;
    }

    const routing = routingRows ?? [];
    const routingActive = routing.filter((r) => r.is_active).length;
    const routingPaused = routing.filter((r) => !r.is_active).length;

    return c.json({
      ok: true,
      data: {
        platformTotal: platformKinds.length,
        platformConnected,
        platformHealthy,
        platformDown,
        routingActive,
        routingPaused,
        routingTotal: routing.length,
        lastProbeAt: (probes?.[0]?.checked_at as string | null) ?? null,
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
    claude_code_agent: ['claude_api_key_ref'],
  };

  const PLATFORM_API_KINDS = [...PLATFORM_KINDS, ...FIX_AGENT_KINDS] as IntegrationKind[];

  app.get('/v1/admin/integrations/platform', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { platform: null } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const allFields = Object.values(PLATFORM_KIND_FIELDS).flat().join(', ');
    const { data: settings } = await db
      .from('project_settings')
      .select(allFields)
      .eq('project_id', project.id)
      .maybeSingle();

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
      platform[kind] = {};
      for (const f of PLATFORM_KIND_FIELDS[kind]) {
        platform[kind][f] = maskField(f, (settings as Record<string, unknown> | null)?.[f]);
      }
    }

    return c.json({ ok: true, data: { platform } });
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
  };

  app.put('/v1/admin/integrations/platform/:kind', jwtAuth, async (c) => {
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

    const allowed = PLATFORM_KIND_FIELDS[kind];
    const vaulted = new Set(VAULTED_FIELDS_BY_KIND[kind] ?? []);
    // Only persist whitelisted fields. Empty strings clear the value (so the
    // UI can offer a "remove" affordance without a separate DELETE endpoint).
    // Masked values from GET ("…abcd") are silently ignored so a partial form
    // submit doesn't replace a real key with a masked one.
    const updates: Record<string, unknown> = { project_id: project.id };
    for (const k of allowed) {
      if (!(k in body)) continue;
      const v = body[k];
      if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue;

      if (v === '' || v === null) {
        updates[k] = null;
        continue;
      }

      if (vaulted.has(k) && typeof v === 'string' && !v.startsWith('vault://')) {
        // Auto-vault: write the raw secret to Supabase Vault and store the ref.
        const secretName = `mushi/integration/${project.id}/${kind}/${k}`;
        const { error: vaultErr } = await db.rpc('vault_store_secret', {
          secret_name: secretName,
          secret_value: v,
        });
        if (vaultErr) {
          // Vault may not be installed in dev — degrade gracefully but warn.
          log.warn('vault_store_secret failed; persisting raw value', {
            scope: 'integrations',
            kind,
            field: k,
            err: vaultErr.message,
          });
          updates[k] = v;
        } else {
          updates[k] = `vault://${secretName}`;
        }
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

}
