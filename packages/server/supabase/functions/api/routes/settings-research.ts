import type { Hono } from 'npm:hono@4';

import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { requireFeature } from '../../_shared/entitlements.ts';
import { logAudit } from '../../_shared/audit.ts';
import { dbError, resolveOwnedProject } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  normalizeSdkConfig,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerSettingsResearchRoutes(app: Hono): void {
  // Settings admin endpoints
  app.get('/v1/admin/settings', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: {} }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data } = await db
      .from('project_settings')
      .select('*')
      .eq('project_id', project.id)
      .single();

    return c.json({ ok: true, data: data ?? {} });
  });

  app.patch('/v1/admin/settings', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();

    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const allowed = [
      'slack_webhook_url',
      'sentry_dsn',
      'sentry_webhook_secret',
      'sentry_consume_user_feedback',
      'stage2_model',
      'stage1_confidence_threshold',
      'dedup_threshold',
      'embedding_model',
      'graph_backend',
    ];
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed.includes(key)) updates[key] = value;
    }

    const { error } = await db
      .from('project_settings')
      .upsert({ project_id: project.id, ...updates }, { onConflict: 'project_id' });

    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  app.get('/v1/admin/projects/:id/sdk-config', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!(await canManageProjectSdkConfig(db, projectId, userId))) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const { data, error } = await db
      .from('project_settings')
      .select(
        'project_id, sdk_config_enabled, sdk_widget_position, sdk_widget_theme, sdk_widget_trigger_text, ' +
          'sdk_capture_console, sdk_capture_network, sdk_capture_performance, sdk_capture_screenshot, ' +
          'sdk_capture_element_selector, sdk_native_trigger_mode, sdk_min_description_length, sdk_config_updated_at',
      )
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) return dbError(c, error);

    return c.json({
      ok: true,
      data: { projectId, ...normalizeSdkConfig(data as SdkConfigRow | null) },
    });
  });

  app.put('/v1/admin/projects/:id/sdk-config', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = getServiceClient();

    if (!(await canManageProjectSdkConfig(db, projectId, userId))) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const updates = coerceSdkConfigUpdate(body);
    const { data, error } = await db
      .from('project_settings')
      .upsert({ project_id: projectId, ...updates }, { onConflict: 'project_id' })
      .select(
        'project_id, sdk_config_enabled, sdk_widget_position, sdk_widget_theme, sdk_widget_trigger_text, ' +
          'sdk_capture_console, sdk_capture_network, sdk_capture_performance, sdk_capture_screenshot, ' +
          'sdk_capture_element_selector, sdk_native_trigger_mode, sdk_min_description_length, sdk_config_updated_at',
      )
      .single();

    if (error) return dbError(c, error);
    await logAudit(
      db,
      projectId,
      userId,
      'settings.updated',
      'sdk_config',
      projectId,
      updates,
    ).catch(() => {});
    return c.json({ ok: true, data: { projectId, ...normalizeSdkConfig(data as SdkConfigRow) } });
  });

  // ============================================================
  // C9: Bring-Your-Own-Key admin endpoints
  //
  // Customers register their own Anthropic / OpenAI keys per project. The raw
  // key never lands in `project_settings`; it is stashed in Supabase Vault and
  // only a `vault://<name>` reference is persisted. The pipeline (fast-filter,
  // classify-report, judge-batch) then dereferences via `resolveLlmKey`.
  // ============================================================

  const BYOK_PROVIDERS = ['anthropic', 'openai'] as const;
  type ByokProvider = (typeof BYOK_PROVIDERS)[number];

  function byokSecretName(projectId: string, provider: ByokProvider): string {
    return `mushi/byok/${projectId}/${provider}`;
  }

  app.get('/v1/admin/byok', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { keys: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data } = await db
      .from('project_settings')
      .select(
        'byok_anthropic_key_ref, byok_anthropic_key_added_at, byok_anthropic_key_last_used_at, byok_anthropic_test_status, byok_anthropic_tested_at, ' +
          'byok_openai_key_ref, byok_openai_key_added_at, byok_openai_key_last_used_at, byok_openai_base_url, byok_openai_test_status, byok_openai_tested_at',
      )
      .eq('project_id', project.id)
      .single();

    const row = (data as Record<string, unknown> | null) ?? {};
    const keys = BYOK_PROVIDERS.map((provider) => ({
      provider,
      configured: Boolean(row[`byok_${provider}_key_ref`]),
      addedAt: (row[`byok_${provider}_key_added_at`] as string | null) ?? null,
      lastUsedAt: (row[`byok_${provider}_key_last_used_at`] as string | null) ?? null,
      testStatus: (row[`byok_${provider}_test_status`] as string | null) ?? null,
      testedAt: (row[`byok_${provider}_tested_at`] as string | null) ?? null,
      baseUrl: provider === 'openai' ? ((row.byok_openai_base_url as string | null) ?? null) : null,
    }));

    return c.json({ ok: true, data: { projectId: project.id, keys } });
  });

  app.put('/v1/admin/byok/:provider', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const provider = c.req.param('provider') as ByokProvider;
    if (!BYOK_PROVIDERS.includes(provider)) {
      return c.json(
        { ok: false, error: { code: 'BAD_PROVIDER', message: `Unknown provider: ${provider}` } },
        400,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      key?: string;
      baseUrl?: string | null;
    };
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (key.length < 8) {
      return c.json(
        {
          ok: false,
          error: { code: 'KEY_TOO_SHORT', message: 'Provide the full provider API key.' },
        },
        400,
      );
    }

    // baseUrl is OpenAI-only — schema constraint, also a defence against any
    // request smuggling a surprise field for `anthropic`.
    const rawBaseUrl =
      provider === 'openai' && typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : '';
    let baseUrl: string | null = null;
    if (rawBaseUrl) {
      try {
        const u = new URL(rawBaseUrl);
        if (u.protocol !== 'https:') {
          return c.json(
            { ok: false, error: { code: 'BAD_BASE_URL', message: 'baseUrl must be https://' } },
            400,
          );
        }
        baseUrl = u.toString().replace(/\/$/, '');
      } catch {
        return c.json(
          { ok: false, error: { code: 'BAD_BASE_URL', message: 'baseUrl is not a valid URL' } },
          400,
        );
      }
    }

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const secretName = byokSecretName(project.id, provider);
    const { error: vaultErr } = await db.rpc('vault_store_secret', {
      secret_name: secretName,
      secret_value: key,
    });
    if (vaultErr) {
      log.error('vault_store_secret failed', { provider, error: vaultErr.message });
      return c.json(
        { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } },
        500,
      );
    }

    const now = new Date().toISOString();
    const update: Record<string, string | null> = {
      [`byok_${provider}_key_ref`]: `vault://${secretName}`,
      [`byok_${provider}_key_added_at`]: now,
      [`byok_${provider}_key_last_used_at`]: null,
      // Reset the connectivity test cache on every key change — stale "ok"
      // chips are dangerous; require an explicit re-test after rotation.
      [`byok_${provider}_test_status`]: null,
      [`byok_${provider}_tested_at`]: null,
    };
    if (provider === 'openai') {
      update.byok_openai_base_url = baseUrl;
    }
    const { error: upsertErr } = await db
      .from('project_settings')
      .upsert({ project_id: project.id, ...update }, { onConflict: 'project_id' });
    if (upsertErr) {
      return dbError(c, upsertErr);
    }

    // 'rotated' covers the upsert path (replacing a prior key); 'added' for first-time.
    // We don't have a cheap pre-read of the existing ref here, so log as 'rotated'
    // — both are auditable mutations and the meta.added_at preserves first-seen.
    //
    // NOTE: PostgrestBuilder is a thenable (`.then` only) — it does NOT expose
    // `.catch()`. Chaining `.catch(() => {})` on `.insert(...)` throws
    // `TypeError: .catch is not a function`, which bubbles to the Hono onError
    // handler and erases the successful upsert above. Use try/await instead.
    try {
      await db.from('byok_audit_log').insert({
        project_id: project.id,
        provider,
        action: 'rotated',
        actor_user_id: userId,
        meta: { added_at: now },
      });
    } catch {
      /* audit log is best-effort */
    }
    await logAudit(db, project.id, userId, 'settings.updated', 'byok', provider, {
      provider,
    }).catch(() => {});

    return c.json({
      ok: true,
      data: { provider, configured: true, addedAt: now, hint: `…${key.slice(-4)}` },
    });
  });

  app.delete('/v1/admin/byok/:provider', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const provider = c.req.param('provider') as ByokProvider;
    if (!BYOK_PROVIDERS.includes(provider)) {
      return c.json({ ok: false, error: { code: 'BAD_PROVIDER' } }, 400);
    }
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const secretName = byokSecretName(project.id, provider);
    try {
      await db.rpc('vault_delete_secret', { secret_name: secretName });
    } catch (err) {
      log.warn('vault_delete_secret failed (non-fatal)', { provider, error: String(err) });
    }

    const { error } = await db.from('project_settings').upsert(
      {
        project_id: project.id,
        [`byok_${provider}_key_ref`]: null,
        [`byok_${provider}_key_added_at`]: null,
        [`byok_${provider}_key_last_used_at`]: null,
      },
      { onConflict: 'project_id' },
    );

    if (error) return dbError(c, error);

    try {
      await db
        .from('byok_audit_log')
        .insert({ project_id: project.id, provider, action: 'removed', actor_user_id: userId });
    } catch {
      /* audit log is best-effort */
    }
    await logAudit(db, project.id, userId, 'settings.updated', 'byok', provider, {
      provider,
      cleared: true,
    }).catch(() => {});

    return c.json({ ok: true });
  });

  /**
   * POST /v1/admin/byok/:provider/test
   *
   * Probe the BYOK key with the cheapest possible call to confirm:
   *   1. The key authenticates (not 401/403).
   *   2. The endpoint is reachable (no DNS/CORS/baseUrl typo).
   *   3. There's quota left (not 429).
   *
   * Persists the outcome (ok / error_auth / error_network / error_quota) to
   * project_settings so the chip stays accurate across reloads. Never logs the
   * key, only the last 4 chars (the BYOK resolver hint).
   *
   * Cost: ~ $0.0001 — uses Anthropic /v1/models or OpenAI /v1/models, both of
   * which are free metadata calls.
   */
  app.post('/v1/admin/byok/:provider/test', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const provider = c.req.param('provider') as ByokProvider;
    if (!BYOK_PROVIDERS.includes(provider)) {
      return c.json({ ok: false, error: { code: 'BAD_PROVIDER' } }, 400);
    }

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    // Reuse the same resolver path the LLM pipeline takes. If this returns null
    // the user has no BYOK and no env fallback — surface that as 'untested'.
    const { resolveLlmKey } = await import('../_shared/byok.ts');
    const resolved = await resolveLlmKey(db, project.id, provider);
    if (!resolved) {
      return c.json(
        {
          ok: false,
          error: { code: 'NO_KEY', message: 'No BYOK key set and no platform default available.' },
        },
        400,
      );
    }

    const startedAt = Date.now();
    let status: 'ok' | 'error_auth' | 'error_network' | 'error_quota' = 'ok';
    let detail = '';
    let httpStatus = 0;

    try {
      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: {
            'x-api-key': resolved.key,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(8_000),
        });
        httpStatus = res.status;
        if (res.status === 401 || res.status === 403) status = 'error_auth';
        else if (res.status === 429) status = 'error_quota';
        else if (!res.ok) {
          status = 'error_network';
          detail = `HTTP ${res.status}`;
        }
      } else {
        // BYOK base URLs come in two flavors:
        //   - "https://api.openai.com" (no version) → append "/v1/models"
        //   - "https://openrouter.ai/api/v1" (already versioned) → append "/models"
        // Detect either form so OpenRouter / Together / Fireworks all probe
        // their actual /models endpoint instead of /v1/v1/models (404).
        const rawBase = (resolved.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
        const modelsUrl = /\/v\d+$/.test(rawBase) ? `${rawBase}/models` : `${rawBase}/v1/models`;
        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${resolved.key}` },
          signal: AbortSignal.timeout(8_000),
        });
        httpStatus = res.status;
        if (res.status === 401 || res.status === 403) status = 'error_auth';
        else if (res.status === 429) status = 'error_quota';
        else if (!res.ok) {
          status = 'error_network';
          detail = `HTTP ${res.status}`;
        }
      }
    } catch (err) {
      status = 'error_network';
      detail = String(err).slice(0, 200);
    }

    const latencyMs = Date.now() - startedAt;
    const now = new Date().toISOString();
    await db.from('project_settings').upsert(
      {
        project_id: project.id,
        [`byok_${provider}_test_status`]: status,
        [`byok_${provider}_tested_at`]: now,
      },
      { onConflict: 'project_id' },
    );

    // Mirror to integration_health_history so the IntegrationsPage sparkline
    // shows BYOK key probes alongside Sentry/Langfuse/GitHub.
    await db.from('integration_health_history').insert({
      project_id: project.id,
      kind: provider,
      status: status === 'ok' ? 'ok' : status === 'error_quota' ? 'degraded' : 'down',
      latency_ms: latencyMs,
      message: detail || `HTTP ${httpStatus}`,
      source: 'manual',
    });

    return c.json({
      ok: true,
      data: {
        provider,
        status,
        hint: resolved.hint,
        source: resolved.source,
        baseUrl: resolved.baseUrl ?? null,
        httpStatus,
        latencyMs,
        detail,
        testedAt: now,
      },
    });
  });

  // ============================================================
  // Firecrawl BYOK admin endpoints
  //
  // Firecrawl is a non-LLM provider (web scraping / search) used by the new
  // research page, fix-worker auto-augmentation, and the library-modernizer
  // cron. Same vault-indirection pattern as the LLM keys but its own column
  // set so the LLM resolver stays single-purpose.
  // ============================================================

  function firecrawlSecretName(projectId: string): string {
    return `mushi/byok/${projectId}/firecrawl`;
  }

  app.get('/v1/admin/byok/firecrawl', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: null }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data } = await db
      .from('project_settings')
      .select(
        'byok_firecrawl_key_ref, byok_firecrawl_key_added_at, byok_firecrawl_key_last_used_at, byok_firecrawl_test_status, byok_firecrawl_tested_at, firecrawl_allowed_domains, firecrawl_max_pages_per_call',
      )
      .eq('project_id', project.id)
      .maybeSingle();

    return c.json({
      ok: true,
      data: {
        configured: Boolean(data?.byok_firecrawl_key_ref),
        addedAt: (data?.byok_firecrawl_key_added_at as string | null) ?? null,
        lastUsedAt: (data?.byok_firecrawl_key_last_used_at as string | null) ?? null,
        testStatus: (data?.byok_firecrawl_test_status as string | null) ?? null,
        testedAt: (data?.byok_firecrawl_tested_at as string | null) ?? null,
        allowedDomains: (data?.firecrawl_allowed_domains as string[] | null) ?? [],
        maxPagesPerCall: (data?.firecrawl_max_pages_per_call as number | null) ?? 5,
      },
    });
  });

  app.put('/v1/admin/byok/firecrawl', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as {
      key?: string;
      allowedDomains?: string[];
      maxPagesPerCall?: number;
    };

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const update: Record<string, unknown> = { project_id: project.id };

    if (typeof body.key === 'string' && body.key.trim().length > 0) {
      const key = body.key.trim();
      if (key.length < 8) {
        return c.json(
          {
            ok: false,
            error: { code: 'KEY_TOO_SHORT', message: 'Provide the full Firecrawl API key.' },
          },
          400,
        );
      }
      const secretName = firecrawlSecretName(project.id);
      const { error: vaultErr } = await db.rpc('vault_store_secret', {
        secret_name: secretName,
        secret_value: key,
      });
      if (vaultErr) {
        log.error('vault_store_secret failed for firecrawl', { error: vaultErr.message });
        return c.json(
          { ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } },
          500,
        );
      }
      update.byok_firecrawl_key_ref = `vault://${secretName}`;
      update.byok_firecrawl_key_added_at = new Date().toISOString();
      update.byok_firecrawl_key_last_used_at = null;
      update.byok_firecrawl_test_status = null;
      update.byok_firecrawl_tested_at = null;
    }

    if (Array.isArray(body.allowedDomains)) {
      update.firecrawl_allowed_domains = body.allowedDomains
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0 && d.length < 254)
        .slice(0, 50);
    }

    if (typeof body.maxPagesPerCall === 'number' && Number.isFinite(body.maxPagesPerCall)) {
      update.firecrawl_max_pages_per_call = Math.max(
        1,
        Math.min(50, Math.floor(body.maxPagesPerCall)),
      );
    }

    const { error } = await db
      .from('project_settings')
      .upsert(update, { onConflict: 'project_id' });
    if (error) return dbError(c, error);

    if (update.byok_firecrawl_key_ref) {
      try {
        await db.from('byok_audit_log').insert({
          project_id: project.id,
          provider: 'firecrawl',
          action: 'rotated',
          actor_user_id: userId,
        });
      } catch {
        /* audit log is best-effort */
      }
      await logAudit(db, project.id, userId, 'settings.updated', 'byok', 'firecrawl', {
        provider: 'firecrawl',
      }).catch(() => {});
    }

    return c.json({ ok: true });
  });

  app.delete('/v1/admin/byok/firecrawl', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const secretName = firecrawlSecretName(project.id);
    try {
      await db.rpc('vault_delete_secret', { secret_name: secretName });
    } catch (err) {
      log.warn('vault_delete_secret failed for firecrawl (non-fatal)', { error: String(err) });
    }

    const { error } = await db.from('project_settings').upsert(
      {
        project_id: project.id,
        byok_firecrawl_key_ref: null,
        byok_firecrawl_key_added_at: null,
        byok_firecrawl_key_last_used_at: null,
        byok_firecrawl_test_status: null,
        byok_firecrawl_tested_at: null,
      },
      { onConflict: 'project_id' },
    );

    if (error) return dbError(c, error);

    try {
      await db.from('byok_audit_log').insert({
        project_id: project.id,
        provider: 'firecrawl',
        action: 'removed',
        actor_user_id: userId,
      });
    } catch {
      /* audit log is best-effort */
    }
    await logAudit(db, project.id, userId, 'settings.updated', 'byok', 'firecrawl', {
      provider: 'firecrawl',
      cleared: true,
    }).catch(() => {});

    return c.json({ ok: true });
  });

  app.post('/v1/admin/byok/firecrawl/test', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { probeFirecrawl } = await import('../_shared/firecrawl.ts');
    const probe = await probeFirecrawl(db, project.id);

    const now = new Date().toISOString();
    await db.from('project_settings').upsert(
      {
        project_id: project.id,
        byok_firecrawl_test_status: probe.status,
        byok_firecrawl_tested_at: now,
      },
      { onConflict: 'project_id' },
    );

    try {
      await db.from('integration_health_history').insert({
        project_id: project.id,
        kind: 'firecrawl',
        status: probe.status === 'ok' ? 'ok' : probe.status === 'error_quota' ? 'degraded' : 'down',
        latency_ms: probe.latencyMs,
        message: probe.detail,
        source: 'manual',
      });
    } catch {
      /* integration_health_history is best-effort */
    }

    return c.json({
      ok: true,
      data: {
        status: probe.status,
        hint: probe.hint,
        source: probe.source,
        latencyMs: probe.latencyMs,
        detail: probe.detail,
        testedAt: now,
      },
    });
  });

  // ============================================================
  // Research page admin endpoints
  //
  // Manual web research powered by Firecrawl. Admin types a query, we hit
  // Firecrawl, persist the session + snippets, and let the user attach any
  // snippet to a specific report as triage evidence.
  // ============================================================

  app.post('/v1/admin/research/search', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      domains?: string[];
      limit?: number;
    };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (query.length < 2 || query.length > 500) {
      return c.json(
        {
          ok: false,
          error: { code: 'BAD_QUERY', message: 'Query must be between 2 and 500 characters.' },
        },
        400,
      );
    }

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { firecrawlSearch } = await import('../_shared/firecrawl.ts');

    let results: Array<{ url: string; title: string; snippet: string; markdown?: string }> = [];
    let errCode: string | null = null;
    try {
      results = await firecrawlSearch(db, project.id, query, {
        domains: Array.isArray(body.domains)
          ? body.domains.filter((d): d is string => typeof d === 'string')
          : undefined,
        limit: typeof body.limit === 'number' ? body.limit : 5,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'FIRECRAWL_NOT_CONFIGURED') {
        return c.json(
          {
            ok: false,
            error: {
              code: 'FIRECRAWL_NOT_CONFIGURED',
              message: 'Add a Firecrawl API key in Settings → BYOK first.',
            },
          },
          412,
        );
      }
      if (msg === 'FIRECRAWL_AUTH_FAILED') {
        return c.json(
          {
            ok: false,
            error: {
              code: 'FIRECRAWL_AUTH_FAILED',
              message: 'Firecrawl rejected the key. Check Settings → BYOK.',
            },
          },
          401,
        );
      }
      if (msg === 'FIRECRAWL_RATE_LIMITED') {
        return c.json(
          {
            ok: false,
            error: { code: 'RATE_LIMITED', message: 'Firecrawl rate-limited. Try again shortly.' },
          },
          429,
        );
      }
      errCode = msg;
      log.warn('research search failed', { projectId: project.id, error: msg });
      return c.json({ ok: false, error: { code: 'SEARCH_FAILED', message: msg } }, 502);
    }

    const { data: session, error: sErr } = await db
      .from('research_sessions')
      .insert({
        project_id: project.id,
        query,
        mode: 'search',
        domains: Array.isArray(body.domains) ? body.domains : [],
        result_count: results.length,
        created_by: userId,
      })
      .select('id, created_at')
      .single();

    if (sErr || !session) {
      return dbError(c, sErr ?? { message: 'Failed to persist session' });
    }

    if (results.length > 0) {
      await db.from('research_snippets').insert(
        results.map((r) => ({
          session_id: session.id,
          project_id: project.id,
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          markdown: r.markdown ?? null,
        })),
      );
    }

    await logAudit(db, project.id, userId, 'settings.updated', 'research', session.id, {
      query: query.slice(0, 120),
      results: results.length,
    }).catch(() => {});

    const { data: snippets } = await db
      .from('research_snippets')
      .select('id, url, title, snippet, attached_to_report_id')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    return c.json({
      ok: true,
      data: {
        sessionId: session.id,
        createdAt: session.created_at,
        query,
        results: snippets ?? [],
        errCode,
      },
    });
  });

  app.get('/v1/admin/research/sessions', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { sessions: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: sessions, error } = await db
      .from('research_sessions')
      .select('id, query, mode, result_count, created_at, created_by')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { sessions: sessions ?? [] } });
  });

  app.get('/v1/admin/research/sessions/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const sessionId = c.req.param('id');
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: session, error: sErr } = await db
      .from('research_sessions')
      .select('id, query, mode, domains, result_count, created_at')
      .eq('id', sessionId)
      .eq('project_id', project.id)
      .maybeSingle();
    if (sErr) return dbError(c, sErr);
    if (!session) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: snippets } = await db
      .from('research_snippets')
      .select('id, url, title, snippet, attached_to_report_id, attached_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });

    return c.json({ ok: true, data: { session, snippets: snippets ?? [] } });
  });

  app.post('/v1/admin/research/snippets/:id/attach', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const snippetId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { reportId?: string };
    const reportId = typeof body.reportId === 'string' ? body.reportId : '';
    if (!reportId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'reportId is required' } },
        400,
      );
    }

    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: report } = await db
      .from('reports')
      .select('id')
      .eq('id', reportId)
      .eq('project_id', project.id)
      .maybeSingle();
    if (!report) return c.json({ ok: false, error: { code: 'REPORT_NOT_FOUND' } }, 404);

    const { error } = await db
      .from('research_snippets')
      .update({
        attached_to_report_id: reportId,
        attached_at: new Date().toISOString(),
        attached_by: userId,
      })
      .eq('id', snippetId)
      .eq('project_id', project.id);

    if (error) return dbError(c, error);

    await logAudit(db, project.id, userId, 'report.triaged', 'research_snippet', snippetId, {
      reportId,
    }).catch(() => {});
    return c.json({ ok: true });
  });
}
