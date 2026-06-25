import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { requireFeature } from '../../_shared/entitlements.ts';
import { logAudit } from '../../_shared/audit.ts';
import { sendTestDelivery } from '../../_shared/plugins.ts';
import { dbError, resolveOwnedProject } from '../shared.ts';

export function registerPluginsMarketplaceRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/plugins', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { plugins: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data, error } = await db
      .from('project_plugins')
      .select(
        'id, plugin_name, plugin_slug, webhook_url, subscribed_events, is_active, last_delivery_at, last_delivery_status, plugin_version, execution_order',
      )
      .eq('project_id', project.id)
      .order('plugin_name', { ascending: true });

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { plugins: data ?? [] } });
  });

  app.post('/v1/admin/plugins', jwtAuth, requireFeature('plugins'), async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const pluginName = body.pluginName ?? body.name;
    const pluginVersion = body.pluginVersion ?? body.version ?? '1.0.0';
    if (!pluginName)
      return c.json(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'pluginName is required' } },
        400,
      );

    // D1: webhook plugins carry a slug + URL + signing secret. Built-in
    // plugins (legacy path) keep the slug-less shape for backwards compat.
    const isWebhook = typeof body.webhookUrl === 'string' && body.webhookUrl.length > 0;
    if (isWebhook && !(typeof body.webhookSecret === 'string' && body.webhookSecret.trim().length > 0)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'MISSING_WEBHOOK_SECRET',
            message: 'webhookSecret is required when webhookUrl is set',
          },
        },
        400,
      );
    }
    let webhookSecretRef: string | null = null;
    if (isWebhook && typeof body.webhookSecret === 'string' && body.webhookSecret.length > 0) {
      const secretName = `mushi/plugin/${project.id}/${body.pluginSlug ?? pluginName}`;
      const { error: vaultErr } = await db.rpc('vault_store_secret', {
        secret_name: secretName,
        secret_value: body.webhookSecret,
      });
      if (vaultErr) {
        return c.json(
          { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } },
          500,
        );
      }
      webhookSecretRef = `vault://${secretName}`;
    }

    const { error } = await db.from('project_plugins').upsert(
      {
        project_id: project.id,
        plugin_name: pluginName,
        plugin_version: pluginVersion,
        plugin_slug: body.pluginSlug ?? null,
        config: body.config,
        is_active: body.isActive ?? true,
        execution_order: body.executionOrder ?? 0,
        webhook_url: isWebhook ? body.webhookUrl : null,
        webhook_secret_vault_ref: webhookSecretRef,
        subscribed_events: Array.isArray(body.subscribedEvents) ? body.subscribedEvents : [],
      },
      { onConflict: 'project_id,plugin_name' },
    );

    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(db, project.id, userId, 'settings.updated', 'plugin', undefined, {
      plugin: pluginName,
      webhook: isWebhook,
    });
    return c.json({ ok: true });
  });

  app.delete('/v1/admin/plugins/:slug', jwtAuth, requireFeature('plugins'), async (c) => {
    const userId = c.get('userId') as string;
    const slug = c.req.param('slug')!;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    try {
      await db.rpc('vault_delete_secret', { secret_name: `mushi/plugin/${project.id}/${slug}` });
    } catch {
      /* vault cleanup is best-effort; plugin row delete is the source of truth */
    }
    const { error } = await db
      .from('project_plugins')
      .delete()
      .eq('project_id', project.id)
      .or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`);
    if (error) return dbError(c, error);
    await logAudit(db, project.id, userId, 'settings.updated', 'plugin', slug, {
      plugin: slug,
      removed: true,
    }).catch(() => {});
    return c.json({ ok: true });
  });

  // ============================================================
  // Plugin lifecycle — patch (pause/resume/edit) + test + rotate
  // ============================================================

  /**
   * PATCH /v1/admin/plugins/:slug
   *
   * Partial update of a single installed plugin.  Only mutates fields the
   * caller explicitly sends — never touches webhook_secret_vault_ref so a
   * URL edit or pause/resume can't accidentally wipe a rotated secret.
   * Accepted fields: isActive, webhookUrl, subscribedEvents, config.
   */
  app.patch('/v1/admin/plugins/:slug', jwtAuth, requireFeature('plugins'), async (c) => {
    const userId = c.get('userId') as string;
    const slug = c.req.param('slug')!;
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const patch: Record<string, unknown> = {};
    if (typeof body.isActive === 'boolean') patch.is_active = body.isActive;
    if (typeof body.webhookUrl === 'string') {
      if (!body.webhookUrl.startsWith('https://')) {
        return c.json(
          { ok: false, error: { code: 'INVALID_INPUT', message: 'webhookUrl must be https://' } },
          400,
        );
      }
      patch.webhook_url = body.webhookUrl;
    }
    if (Array.isArray(body.subscribedEvents)) {
      patch.subscribed_events = body.subscribedEvents.filter(
        (e: unknown): e is string => typeof e === 'string',
      );
    }
    if (body.config && typeof body.config === 'object') patch.config = body.config;

    if (Object.keys(patch).length === 0) {
      return c.json(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'No mutable fields supplied' } },
        400,
      );
    }

    const { error, data } = await db
      .from('project_plugins')
      .update(patch)
      .eq('project_id', project.id)
      .or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`)
      .select('id')
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!data) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Plugin not installed' } },
        404,
      );
    }

    await logAudit(db, project.id, userId, 'settings.updated', 'plugin', slug, {
      action: 'patch',
      fields: Object.keys(patch),
    }).catch(() => {});
    return c.json({ ok: true });
  });

  /**
   * POST /v1/admin/plugins/:slug/test-event
   *
   * Fire a `test.delivery` event at the plugin's webhook URL using the same
   * HMAC signing path as a real dispatch. A row is written to
   * `plugin_dispatch_log` so the result surfaces in the dispatch table.
   * Returns { httpStatus, durationMs, excerpt } so the UI can confirm the
   * receiver is reachable.
   */
  app.post('/v1/admin/plugins/:slug/test-event', jwtAuth, requireFeature('plugins'), async (c) => {
    const userId = c.get('userId') as string;
    const slug = c.req.param('slug')!;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const result = await sendTestDelivery(db, project.id, slug);
    await logAudit(db, project.id, userId, 'settings.updated', 'plugin', slug, {
      action: 'test_event',
      ok: result.ok,
    }).catch(() => {});

    return c.json({
      ok: true,
      data: {
        delivered: result.ok,
        httpStatus: result.httpStatus,
        durationMs: result.durationMs,
        excerpt: result.excerpt,
      },
    });
  });

  /**
   * POST /v1/admin/plugins/:slug/rotate-secret
   *
   * Generate a new 32-byte signing secret, overwrite the existing vault
   * entry (canonical secret_name comes from the DB row's vault_ref so we
   * can't be tricked into writing arbitrary keys via the URL), and return
   * the plaintext exactly once. In-flight dispatches that already loaded
   * the old secret complete normally; new dispatches pick up the new
   * secret on their next vault_lookup call.
   */
  app.post(
    '/v1/admin/plugins/:slug/rotate-secret',
    jwtAuth,
    requireFeature('plugins'),
    async (c) => {
      const userId = c.get('userId') as string;
      const slug = c.req.param('slug')!;
      const db = getServiceClient();
      const resolvedProject = await resolveOwnedProject(c, db, userId);
      if ('response' in resolvedProject) return resolvedProject.response;
      const project = resolvedProject.project;

      const { data: pluginRow, error: lookupErr } = await db
        .from('project_plugins')
        .select('plugin_slug, plugin_name, webhook_secret_vault_ref')
        .eq('project_id', project.id)
        .or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`)
        .maybeSingle();
      if (lookupErr) return dbError(c, lookupErr);
      if (!pluginRow) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Plugin not installed' } },
          404,
        );
      }

      // Canonical secret_name: prefer the existing vault_ref (rotation in
      // place), fall back to the slug-derived path for legacy rows that
      // were installed without a webhook secret.
      const secretName = pluginRow.webhook_secret_vault_ref?.startsWith('vault://')
        ? pluginRow.webhook_secret_vault_ref.slice('vault://'.length)
        : `mushi/plugin/${project.id}/${pluginRow.plugin_slug ?? pluginRow.plugin_name}`;

      const newSecretBytes = new Uint8Array(32);
      crypto.getRandomValues(newSecretBytes);
      const newSecret = Array.from(newSecretBytes, (b) => b.toString(16).padStart(2, '0')).join('');

      const { error: vaultErr } = await db.rpc('vault_store_secret', {
        secret_name: secretName,
        secret_value: newSecret,
      });
      if (vaultErr) {
        return c.json(
          { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } },
          500,
        );
      }

      // If the plugin was previously installed without a secret, point the
      // row at the freshly written vault entry so dispatch() picks it up.
      if (!pluginRow.webhook_secret_vault_ref) {
        await db
          .from('project_plugins')
          .update({ webhook_secret_vault_ref: `vault://${secretName}` })
          .eq('project_id', project.id)
          .or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`);
      }

      await logAudit(db, project.id, userId, 'settings.updated', 'plugin', slug, {
        action: 'rotate_secret',
      }).catch(() => {});

      return c.json({ ok: true, data: { secret: newSecret } });
    },
  );

  // ============================================================
  // D1: Plugin marketplace browse + dispatch log
  // ============================================================

  app.get('/v1/marketplace/plugins', async (c) => {
    const db = getServiceClient();
    const { data, error } = await db
      .from('plugin_registry')
      .select(
        'slug, name, short_description, long_description, publisher, source_url, manifest, required_scopes, install_count, category, is_official',
      )
      .eq('is_listed', true)
      .order('is_official', { ascending: false })
      .order('install_count', { ascending: false });

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { plugins: data ?? [] } });
  });

  /**
   * Wave G3 — community-plugin submission.
   *
   * Any authenticated user can propose a new plugin listing. Submissions land
   * in `plugin_submissions` with `status='pending_review'`; admin triage
   * flips them to `approved` (moves row into `plugin_registry`) or
   * `rejected` (stays in submissions with a reason). Keeps public
   * `plugin_registry` curated without blocking community contributions.
   */
  app.post('/v1/marketplace/submissions', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json()) as {
      slug?: string;
      name?: string;
      shortDescription?: string;
      longDescription?: string;
      publisher?: string;
      sourceUrl?: string;
      manifest?: Record<string, unknown>;
      requiredScopes?: string[];
      category?: string;
    };
    if (!body.slug || !/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(body.slug)) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_SLUG', message: 'slug must be kebab-case, 3-50 chars' },
        },
        400,
      );
    }
    if (!body.name || !body.shortDescription || !body.sourceUrl) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'MISSING_FIELDS',
            message: 'name, shortDescription, sourceUrl are required',
          },
        },
        400,
      );
    }
    if (
      body.name.length > 100 ||
      body.shortDescription.length > 280 ||
      (body.longDescription?.length ?? 0) > 8000 ||
      (body.publisher?.length ?? 0) > 100
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'FIELD_TOO_LONG',
            message: 'name ≤100, shortDescription ≤280, longDescription ≤8000, publisher ≤100',
          },
        },
        400,
      );
    }
    if (!/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//.test(body.sourceUrl)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_SOURCE_URL',
            message: 'sourceUrl must be a GitHub/GitLab/Bitbucket https URL',
          },
        },
        400,
      );
    }
    if (
      Array.isArray(body.requiredScopes) &&
      (body.requiredScopes.length > 32 ||
        body.requiredScopes.some((s) => typeof s !== 'string' || s.length > 100))
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_SCOPES',
            message: 'requiredScopes must be ≤32 strings of ≤100 chars',
          },
        },
        400,
      );
    }
    if (body.manifest && JSON.stringify(body.manifest).length > 32_000) {
      return c.json(
        {
          ok: false,
          error: { code: 'MANIFEST_TOO_LARGE', message: 'manifest JSON must be ≤32kB' },
        },
        400,
      );
    }
    const db = getServiceClient();
    const { data: existing } = await db
      .from('plugin_registry')
      .select('slug')
      .eq('slug', body.slug)
      .maybeSingle();
    if (existing) {
      return c.json(
        { ok: false, error: { code: 'SLUG_TAKEN', message: 'Slug already registered' } },
        409,
      );
    }
    const { data, error } = await db
      .from('plugin_submissions')
      .insert({
        slug: body.slug,
        name: body.name,
        short_description: body.shortDescription,
        long_description: body.longDescription ?? null,
        publisher: body.publisher ?? null,
        source_url: body.sourceUrl,
        manifest: body.manifest ?? {},
        required_scopes: body.requiredScopes ?? [],
        category: body.category ?? 'other',
        submitted_by: userId,
        status: 'pending_review',
      })
      .select('id, slug, status')
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data }, 201);
  });

  app.get('/v1/admin/marketplace/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      catalogTotal: 0,
      installedTotal: 0,
      installedActive: 0,
      installedPaused: 0,
      deliveries7d: 0,
      deliveriesOk: 0,
      deliveriesFailed: 0,
      deliverySuccessRatePct: 0,
      lastDeliveryAt: null as string | null,
      daysSinceLastDelivery: null as number | null,
      failingPlugins: 0,
      neverDeliveredPlugins: 0,
      topPriority: 'no_project' as
        | 'no_project'
        | 'delivery_failures'
        | 'plugins_paused'
        | 'no_plugins_installed'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [catalogRes, installedRes, dispatchRes] = await Promise.all([
      db.from('plugin_registry').select('slug', { count: 'exact', head: true }).eq('is_listed', true),
      db
        .from('project_plugins')
        .select('is_active, last_delivery_status, last_delivery_at')
        .eq('project_id', project.id),
      db
        .from('plugin_dispatch_log')
        .select('status, created_at')
        .eq('project_id', project.id)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const installed = installedRes.data ?? [];
    const dispatch = dispatchRes.data ?? [];
    let deliveriesOk = 0;
    let deliveriesFailed = 0;
    let lastDeliveryAt: string | null = null;

    for (const row of dispatch) {
      const status = row.status as string;
      if (status === 'ok') deliveriesOk += 1;
      if (status === 'error' || status === 'timeout') deliveriesFailed += 1;
      if (!lastDeliveryAt && row.created_at) lastDeliveryAt = row.created_at as string;
    }

    const failingPlugins = installed.filter(
      (p) =>
        p.last_delivery_status === 'error' || p.last_delivery_status === 'timeout',
    ).length;
    const neverDeliveredPlugins = installed.filter(
      (p) => p.is_active && !p.last_delivery_at,
    ).length;
    const deliverySuccessRatePct =
      dispatch.length > 0 ? Math.round((deliveriesOk / dispatch.length) * 100) : 0;
    const daysSinceLastDelivery = lastDeliveryAt
      ? Math.floor((Date.now() - new Date(lastDeliveryAt).getTime()) / (24 * 60 * 60 * 1000))
      : null;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (deliveriesFailed > 0 || failingPlugins > 0) {
      topPriority = 'delivery_failures';
      topPriorityLabel = `${deliveriesFailed} failed deliver${deliveriesFailed === 1 ? 'y' : 'ies'} in 7d · ${failingPlugins} plugin${failingPlugins === 1 ? '' : 's'} with last status error/timeout — check Deliveries tab.`;
      topPriorityTo = '/marketplace?tab=deliveries';
    } else if (installed.filter((p) => !p.is_active).length > 0) {
      topPriority = 'plugins_paused';
      topPriorityLabel = `${installed.filter((p) => !p.is_active).length} plugin${installed.filter((p) => !p.is_active).length === 1 ? '' : 's'} paused — resume on Installed tab to receive events again.`;
      topPriorityTo = '/marketplace?tab=installed';
    } else if (installed.length === 0) {
      topPriority = 'no_plugins_installed';
      topPriorityLabel = `${catalogRes.count ?? 0} plugin${(catalogRes.count ?? 0) === 1 ? '' : 's'} in catalog — install a webhook receiver to react when reports classify or fixes land.`;
      topPriorityTo = '/marketplace?tab=browse';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${installed.filter((p) => p.is_active).length} active · ${deliveriesOk} ok / ${dispatch.length} deliveries (7d) · ${deliverySuccessRatePct}% success rate.`;
      topPriorityTo = '/marketplace?tab=deliveries';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: project.id as string,
        projectName: (project.name as string | null) ?? null,
        catalogTotal: catalogRes.count ?? 0,
        installedTotal: installed.length,
        installedActive: installed.filter((p) => p.is_active).length,
        installedPaused: installed.filter((p) => !p.is_active).length,
        deliveries7d: dispatch.length,
        deliveriesOk,
        deliveriesFailed,
        deliverySuccessRatePct,
        lastDeliveryAt,
        daysSinceLastDelivery,
        failingPlugins,
        neverDeliveredPlugins,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/plugins/dispatch-log', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { entries: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data, error } = await db
      .from('plugin_dispatch_log')
      .select(
        'id, delivery_id, plugin_slug, event, status, http_status, duration_ms, response_excerpt, created_at',
      )
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { entries: data ?? [] } });
  });

}
