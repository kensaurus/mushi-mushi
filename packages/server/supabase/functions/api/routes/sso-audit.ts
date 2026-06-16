import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { requireFeature, resolveActiveEntitlement } from '../../_shared/entitlements.ts';
import { logAudit } from '../../_shared/audit.ts';
import { callerProjectIds, resolveOwnedProject } from '../shared.ts';

export function registerSsoAuditRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // PHASE 4: ENTERPRISE — SSO, AUDIT, RETENTION, FINE-TUNING
  // ============================================================

  app.get('/v1/admin/sso/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      ssoEntitlement: false,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      totalConfigs: 0,
      registeredCount: 0,
      pendingCount: 0,
      failedCount: 0,
      manualRequiredCount: 0,
      disabledCount: 0,
      activeCount: 0,
      domainCount: 0,
      lastRegisteredAt: null as string | null,
      defaultAcsUrl: null as string | null,
      latestFailure: null as string | null,
      latestProviderName: null as string | null,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const entitlement = await resolveActiveEntitlement(c);
    const plan = entitlement?.plan;
    const ssoEntitlement = entitlement?.hasFeature('sso') ?? false;

    const { data: configs } = await db
      .from('enterprise_sso_configs')
      .select(
        'provider_name, registration_status, is_active, domains, registered_at, registration_error, acs_url',
      )
      .eq('project_id', project.id);

    const rows = configs ?? [];
    let registeredCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let manualRequiredCount = 0;
    let disabledCount = 0;
    let activeCount = 0;
    let domainCount = 0;
    let lastRegisteredAt: string | null = null;
    let latestFailure: string | null = null;
    let latestProviderName: string | null = null;
    let acsFromConfig: string | null = null;

    for (const row of rows) {
      const status = row.registration_status as string;
      if (status === 'registered') registeredCount += 1;
      else if (status === 'pending') pendingCount += 1;
      else if (status === 'failed') failedCount += 1;
      else if (status === 'manual_required') manualRequiredCount += 1;
      else if (status === 'disabled') disabledCount += 1;
      if (row.is_active) activeCount += 1;
      domainCount += Array.isArray(row.domains) ? row.domains.length : 0;
      if (row.registered_at && (!lastRegisteredAt || row.registered_at > lastRegisteredAt)) {
        lastRegisteredAt = row.registered_at;
      }
      if (status === 'failed' && row.registration_error) {
        latestFailure = row.registration_error;
        latestProviderName = row.provider_name;
      }
      if (status === 'registered' && row.acs_url && !acsFromConfig) {
        acsFromConfig = row.acs_url;
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? null;
    const defaultAcsUrl =
      acsFromConfig ?? (supabaseUrl ? `${supabaseUrl}/auth/v1/sso/saml/acs` : null);

    return c.json({
      ok: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        ssoEntitlement,
        planId: plan?.id ?? 'hobby',
        planDisplayName: plan?.display_name ?? 'Hobby',
        totalConfigs: rows.length,
        registeredCount,
        pendingCount,
        failedCount,
        manualRequiredCount,
        disabledCount,
        activeCount,
        domainCount,
        lastRegisteredAt,
        defaultAcsUrl,
        latestFailure,
        latestProviderName,
      },
    });
  });

  app.get('/v1/admin/sso', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { configs: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const { data } = await db
      .from('enterprise_sso_configs')
      .select(
        'id, project_id, provider_type, provider_name, metadata_url, entity_id, acs_url, is_active, sso_provider_id, registration_status, registration_error, registered_at, domains, created_at',
      )
      .eq('project_id', project.id)
      .limit(50);
    return c.json({ ok: true, data: { configs: data ?? [] } });
  });

  // Register a SAML/OIDC provider against the Supabase Auth Admin API and
  // persist a row that mirrors the canonical `auth.sso_providers` entry.
  //
  // SAML: ships the IdP metadata URL straight to GoTrue, which fetches +
  // caches it, then mints an ACS URL the user must configure on their IdP.
  // OIDC: stored in our table and surfaced to the UI; OIDC support in
  // supabase-go-true admin API is gated to enterprise tiers, so we record it
  // as 'pending' and let the operator wire it manually if their plan allows.
  //
  // Returns the canonical Auth provider ID + status so the UI can show the
  // admin which step they're on (config saved → registered → active).
  app.post('/v1/admin/sso', jwtAuth, requireFeature('sso'), async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as {
      providerType: 'saml' | 'oidc';
      providerName: string;
      metadataUrl?: string;
      metadataXml?: string;
      entityId?: string;
      acsUrl?: string;
      domains?: string[];
    };
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    if (!['saml', 'oidc'].includes(body.providerType)) {
      return c.json(
        {
          ok: false,
          error: { code: 'BAD_PROVIDER', message: 'providerType must be saml or oidc' },
        },
        400,
      );
    }
    if (!body.providerName?.trim()) {
      return c.json(
        { ok: false, error: { code: 'MISSING_NAME', message: 'providerName is required' } },
        400,
      );
    }

    // First persist a row in 'pending' so the UI sees state immediately even if
    // the GoTrue call fails. We update the row to 'registered' on success.
    const { data: configRow, error: insertErr } = await db
      .from('enterprise_sso_configs')
      .insert({
        project_id: project.id,
        provider_type: body.providerType,
        provider_name: body.providerName,
        metadata_url: body.metadataUrl ?? null,
        entity_id: body.entityId ?? null,
        acs_url: body.acsUrl ?? null,
        domains: body.domains ?? [],
        registration_status: 'pending',
      })
      .select('id')
      .single();

    if (insertErr || !configRow) {
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: insertErr?.message ?? 'insert failed' } },
        400,
      );
    }

    // SAML registration via GoTrue Admin API. We POST to /auth/v1/admin/sso/providers
    // with the metadata URL; GoTrue fetches + parses it server-side and
    // returns the canonical provider ID + ACS URL.
    if (body.providerType === 'saml') {
      if (!body.metadataUrl && !body.metadataXml) {
        await db
          .from('enterprise_sso_configs')
          .update({
            registration_status: 'failed',
            registration_error: 'SAML requires either metadataUrl or metadataXml',
          })
          .eq('id', configRow.id);
        return c.json(
          {
            ok: false,
            error: {
              code: 'MISSING_METADATA',
              message: 'SAML registration requires metadataUrl or metadataXml',
            },
          },
          400,
        );
      }

      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const goTrueRes = await fetch(`${supabaseUrl}/auth/v1/admin/sso/providers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            type: 'saml',
            metadata_url: body.metadataUrl,
            metadata_xml: body.metadataXml,
            domains: body.domains ?? [],
            attribute_mapping: {
              keys: {
                email: { name: 'email' },
                name: { name: 'displayName' },
              },
            },
          }),
        });
        const text = await goTrueRes.text();
        if (!goTrueRes.ok) {
          await db
            .from('enterprise_sso_configs')
            .update({
              registration_status: 'failed',
              registration_error: `GoTrue ${goTrueRes.status}: ${text.slice(0, 500)}`,
            })
            .eq('id', configRow.id);
          await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
            action: 'sso_register_failed',
            providerType: body.providerType,
            status: goTrueRes.status,
          });
          return c.json(
            { ok: false, error: { code: 'GOTRUE_ERROR', message: text.slice(0, 200) } },
            goTrueRes.status >= 500 ? 502 : 400,
          );
        }
        const provider = JSON.parse(text) as {
          id: string;
          saml?: { entity_id?: string; metadata_url?: string };
        };
        await db
          .from('enterprise_sso_configs')
          .update({
            sso_provider_id: provider.id,
            entity_id: provider.saml?.entity_id ?? body.entityId ?? null,
            acs_url: `${supabaseUrl}/auth/v1/sso/saml/acs`,
            registration_status: 'registered',
            registration_error: null,
            registered_at: new Date().toISOString(),
            is_active: true,
          })
          .eq('id', configRow.id);

        await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
          action: 'sso_registered',
          providerType: 'saml',
          providerId: provider.id,
        });

        return c.json({
          ok: true,
          data: {
            id: configRow.id,
            providerId: provider.id,
            acsUrl: `${supabaseUrl}/auth/v1/sso/saml/acs`,
            entityId: provider.saml?.entity_id,
            status: 'registered',
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .from('enterprise_sso_configs')
          .update({
            registration_status: 'failed',
            registration_error: msg.slice(0, 500),
          })
          .eq('id', configRow.id);
        return c.json({ ok: false, error: { code: 'NETWORK_ERROR', message: msg } }, 502);
      }
    }

    // OIDC: GoTrue's Admin SSO API only exposes SAML registration today —
    // OIDC providers must be wired up by Supabase support per-tenant. We
    // still persist the row + audit-log the request (so the operator's
    // change history is complete and so we have evidence to back up
    // their support ticket), but we deliberately mark the
    // registration_status as 'manual_required' (not 'pending', which
    // would imply Mushi will get to it on the next tick) and respond
    // with **202 Accepted** + a clear hint. 202 is the honest HTTP
    // status: we have received the request and stored it, but the work
    // is not complete and may require an out-of-band action.
    //
    // When the GoTrue OIDC admin endpoint ships, drop the env-var gate
    // below and inline the registration the same way SAML does.
    await db
      .from('enterprise_sso_configs')
      .update({
        registration_status: 'manual_required',
        registration_error:
          'OIDC requires manual provisioning by Supabase support. SAML 2.0 is fully self-service today.',
      })
      .eq('id', configRow.id);

    await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
      action: 'sso_added',
      providerType: body.providerType,
      autoRegistered: false,
    });

    return c.json(
      {
        ok: true,
        data: {
          id: configRow.id,
          status: 'manual_required',
          hint: 'OIDC config saved for audit. Mushi cannot auto-register OIDC providers — open a Supabase support ticket and reference this config id, or switch to SAML 2.0 for self-service.',
        },
      },
      202,
    );
  });

  // Allow disconnecting an SSO provider. We deregister from GoTrue first,
  // then mark the config row 'disabled'. We never hard-delete rows because the
  // audit log + sso_state attempts reference them.
  app.delete('/v1/admin/sso/:id', jwtAuth, requireFeature('sso'), async (c) => {
    const userId = c.get('userId') as string;
    const configId = c.req.param('id')!;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: config } = await db
      .from('enterprise_sso_configs')
      .select('id, sso_provider_id')
      .eq('id', configId)
      .eq('project_id', project.id)
      .maybeSingle();
    if (!config) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    if (config.sso_provider_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const res = await fetch(
        `${supabaseUrl}/auth/v1/admin/sso/providers/${config.sso_provider_id}`,
        {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        return c.json(
          { ok: false, error: { code: 'GOTRUE_ERROR', message: text.slice(0, 200) } },
          502,
        );
      }
    }

    await db
      .from('enterprise_sso_configs')
      .update({
        is_active: false,
        registration_status: 'disabled',
      })
      .eq('id', configId);

    await logAudit(db, project.id, userId, 'settings.deleted', 'sso', configId, {
      action: 'sso_disabled',
    });
    return c.json({ ok: true });
  });

  app.get('/v1/admin/audit/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      auditLogEntitlement: false,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      projectCount: 0,
      totalEvents: 0,
      events24h: 0,
      events7d: 0,
      failCount24h: 0,
      warnCount24h: 0,
      humanCount24h: 0,
      agentCount24h: 0,
      systemCount24h: 0,
      activeProjectEvents24h: 0,
      latestEventAt: null as string | null,
      latestAction: null as string | null,
      latestActorEmail: null as string | null,
      topAction7d: null as string | null,
      topAction7dCount: 0,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const entitlement = await resolveActiveEntitlement(c);
    const plan = entitlement?.plan;
    const auditLogEntitlement = entitlement?.hasFeature('audit_log') ?? false;

    const projectIds = await callerProjectIds(c, db, userId);
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const FAIL_ACTIONS = ['fix.failed', 'integration.disconnected'];
    const WARN_ACTIONS = ['api_key.revoked', 'plugin.uninstalled'];

    const [
      { count: totalEvents },
      { count: events24h },
      { count: events7d },
      { count: activeProjectEvents24h },
      { data: recentRows },
      { data: failRows },
      { data: warnRows },
      { data: topRows },
    ] = await Promise.all([
      db.from('audit_logs').select('id', { count: 'exact', head: true }).in('project_id', projectIds),
      db
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .gte('created_at', since24h),
      db
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .gte('created_at', since7d),
      db
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .gte('created_at', since24h),
      db
        .from('audit_logs')
        .select('action, actor_email, actor_id, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('audit_logs')
        .select('id')
        .in('project_id', projectIds)
        .gte('created_at', since24h)
        .in('action', FAIL_ACTIONS),
      db
        .from('audit_logs')
        .select('id')
        .in('project_id', projectIds)
        .gte('created_at', since24h)
        .in('action', WARN_ACTIONS),
      db
        .from('audit_logs')
        .select('action')
        .in('project_id', projectIds)
        .gte('created_at', since7d)
        .limit(500),
    ]);

    let humanCount24h = 0;
    let agentCount24h = 0;
    let systemCount24h = 0;
    for (const row of recentRows ?? []) {
      const createdAt = row.created_at as string;
      if (createdAt < since24h) continue;
      const actorId = row.actor_id as string | null;
      const actorEmail = row.actor_email as string | null;
      if (
        actorId &&
        (actorId.startsWith('agent_') || (actorEmail?.startsWith('agent-') ?? false))
      ) {
        agentCount24h += 1;
      } else if (
        !actorId ||
        actorId.startsWith('cron_') ||
        actorId.startsWith('system_') ||
        actorId.startsWith('webhook_')
      ) {
        systemCount24h += 1;
      } else if (actorEmail && actorId) {
        humanCount24h += 1;
      } else {
        systemCount24h += 1;
      }
    }

    const actionCounts = new Map<string, number>();
    for (const row of topRows ?? []) {
      const action = row.action as string;
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
    }
    let topAction7d: string | null = null;
    let topAction7dCount = 0;
    for (const [action, count] of actionCounts) {
      if (count > topAction7dCount) {
        topAction7d = action;
        topAction7dCount = count;
      }
    }

    const latest = recentRows?.[0];

    return c.json({
      ok: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        auditLogEntitlement,
        planId: plan?.id ?? 'hobby',
        planDisplayName: plan?.display_name ?? 'Hobby',
        projectCount: projectIds.length,
        totalEvents: totalEvents ?? 0,
        events24h: events24h ?? 0,
        events7d: events7d ?? 0,
        failCount24h: failRows?.length ?? 0,
        warnCount24h: warnRows?.length ?? 0,
        humanCount24h,
        agentCount24h,
        systemCount24h,
        activeProjectEvents24h: activeProjectEvents24h ?? 0,
        latestEventAt: (latest?.created_at as string | undefined) ?? null,
        latestAction: (latest?.action as string | undefined) ?? null,
        latestActorEmail: (latest?.actor_email as string | undefined) ?? null,
        topAction7d,
        topAction7dCount,
      },
    });
  });

  app.get('/v1/admin/audit', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const action = c.req.query('action');
    const resourceType = c.req.query('resource_type');
    const actor = c.req.query('actor');
    // actor_type is derived from actor_id shape so the FE can split human vs
    // agent vs system bots (cron / webhook / migration). .
    // Mapping:
    //   human  -> actor_id is a uuid (auth.users.id) AND actor_email is set
    //   agent  -> actor_id starts with 'agent_' or actor_email like 'agent-%@'
    //   system -> actor_id is null OR starts with 'cron_' / 'system_' / 'webhook_'
    const actorType = c.req.query('actor_type') as 'human' | 'agent' | 'system' | undefined;
    const since = c.req.query('since');
    const q = c.req.query('q')?.trim();
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);

    let query = db
      .from('audit_logs')
      .select(
        'id, project_id, actor_id, actor_email, action, resource_type, resource_id, metadata, created_at',
        { count: 'exact' },
      )
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) query = query.eq('action', action);
    if (resourceType) query = query.eq('resource_type', resourceType);
    if (actor) query = query.ilike('actor_email', `%${actor}%`);
    if (since) query = query.gte('created_at', since);
    if (q)
      query = query.or(`action.ilike.%${q}%,resource_type.ilike.%${q}%,resource_id.ilike.%${q}%`);
    if (actorType === 'human') {
      // A real human always has both an email and a uuid actor_id.
      query = query.not('actor_email', 'is', null).not('actor_id', 'is', null);
    } else if (actorType === 'agent') {
      query = query.or('actor_id.like.agent_%,actor_email.like.agent-%@%');
    } else if (actorType === 'system') {
      query = query.or(
        'actor_id.is.null,actor_id.like.cron_%,actor_id.like.system_%,actor_id.like.webhook_%',
      );
    }

    const { data, count } = await query;
    return c.json({ ok: true, data: { logs: data ?? [], count: count ?? 0 } });
  });

}
