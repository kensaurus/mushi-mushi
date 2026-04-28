import type { Hono } from 'npm:hono@4';

import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { requireFeature } from '../../_shared/entitlements.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { getActivePlugins } from '../../_shared/plugins.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds, resolveOwnedProject } from '../shared.ts';

export function registerEnterpriseIntegrationsRoutes(app: Hono): void {
  // ============================================================
  // PHASE 4: ENTERPRISE — SSO, AUDIT, RETENTION, FINE-TUNING
  // ============================================================

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

    // OIDC: GoTrue Admin SSO API only supports SAML today. We persist the
    // config so the operator sees their intent recorded, with a clear
    // pending-status hint in the UI.
    await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
      action: 'sso_added',
      providerType: body.providerType,
    });
    return c.json({
      ok: true,
      data: {
        id: configRow.id,
        status: 'pending',
        hint: 'OIDC is recorded but not yet auto-registered. Contact support to enable OIDC for your tenant, or use SAML for self-service.',
      },
    });
  });

  // Allow disconnecting an SSO provider. We deregister from GoTrue first,
  // then mark the config row 'disabled'. We never hard-delete rows because the
  // audit log + sso_state attempts reference them.
  app.delete('/v1/admin/sso/:id', jwtAuth, requireFeature('sso'), async (c) => {
    const userId = c.get('userId') as string;
    const configId = c.req.param('id');
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

  app.get('/v1/admin/audit', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

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

  app.get('/v1/admin/fine-tuning', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const { data } = await db
      .from('fine_tuning_jobs')
      .select(
        'id, project_id, base_model, status, training_samples, fine_tuned_model_id, metrics, validation_report, export_storage_path, export_size_bytes, promote_to_stage, promoted_at, rejected_reason, started_at, completed_at, created_at',
      )
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    return c.json({ ok: true, data: { jobs: data ?? [] } });
  });

  app.post('/v1/admin/fine-tuning', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: job, error } = await db
      .from('fine_tuning_jobs')
      .insert({
        project_id: project.id,
        base_model: body.baseModel ?? ANTHROPIC_SONNET,
        status: 'pending',
        promote_to_stage: body.promoteToStage ?? null,
        sample_window_days: body.sampleWindowDays ?? 30,
        min_confidence: body.minConfidence ?? 0.85,
        labelled_judge_only: body.labelledJudgeOnly ?? true,
        export_format: body.exportFormat ?? 'jsonl_classification',
      })
      .select('id')
      .single();

    if (error) return dbError(c, error);
    await logAudit(db, project.id, userId, 'settings.updated', 'fine_tuning', job!.id, {
      baseModel: body.baseModel,
    });
    return c.json({ ok: true, data: { jobId: job!.id } });
  });

  // V5.3 §2.15 (B4): export step — render JSONL training set and upload it.
  app.post('/v1/admin/fine-tuning/:id/export', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job, error: loadErr } = await db
      .from('fine_tuning_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (loadErr || !job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    if (job.status !== 'pending' && job.status !== 'rejected' && job.status !== 'failed') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Job is ${job.status}; export only valid from pending/rejected/failed`,
          },
        },
        409,
      );
    }

    await db
      .from('fine_tuning_jobs')
      .update({ status: 'exporting', started_at: new Date().toISOString() })
      .eq('id', jobId);
    try {
      const { gatherTrainingSamples, renderJsonl, uploadAndRecordExport } =
        await import('../_shared/fine-tune.ts');
      const samples = await gatherTrainingSamples(db, job);
      const jsonl = renderJsonl(samples, job.export_format);
      const result = await uploadAndRecordExport(db, job, jsonl, samples.length);
      await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_export', jobId, {
        sampleCount: result.sampleCount,
        sizeBytes: result.sizeBytes,
      });
      return c.json({ ok: true, data: result });
    } catch (e) {
      await db
        .from('fine_tuning_jobs')
        .update({
          status: 'failed',
          rejected_reason: e instanceof Error ? e.message : String(e),
        })
        .eq('id', jobId);
      return c.json(
        {
          ok: false,
          error: { code: 'EXPORT_FAILED', message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }
  });

  // V5.3 §2.15 (B4) — Wave S5: submit the exported JSONL to the training
  // vendor. This moves the job from `exported` → `training` and stores the
  // vendor job ID in `metrics.vendor_job_id`. Must be paired with the `poll`
  // endpoint (or the vendor webhook) to advance to `trained`.
  app.post('/v1/admin/fine-tuning/:id/submit', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    if (job.status !== 'exported') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Job is ${job.status}; submit only valid from exported`,
          },
        },
        409,
      );
    }

    try {
      const { resolveVendor, getAdapter } = await import('../_shared/fine-tune-vendor.ts');
      const vendor = resolveVendor(job.base_model);
      const adapter = getAdapter(vendor);
      const result = await adapter.submit(db, job);
      await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_submit', jobId, {
        vendor: result.vendor,
        vendorJobId: result.vendorJobId,
      });
      return c.json({ ok: true, data: result });
    } catch (e) {
      await db
        .from('fine_tuning_jobs')
        .update({
          status: 'failed',
          rejected_reason: e instanceof Error ? e.message : String(e),
        })
        .eq('id', jobId);
      return c.json(
        {
          ok: false,
          error: { code: 'SUBMIT_FAILED', message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }
  });

  // Poll the vendor for completion. Usually called by cron every ~5 min;
  // kept as an admin endpoint so operators can also force a check.
  app.post('/v1/admin/fine-tuning/:id/poll', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    if (job.status !== 'training') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Job is ${job.status}; poll only valid while training`,
          },
        },
        409,
      );
    }

    try {
      const { resolveVendor, getAdapter } = await import('../_shared/fine-tune-vendor.ts');
      const vendor = resolveVendor(job.base_model);
      const adapter = getAdapter(vendor);
      const result = await adapter.poll(job);

      if (result.status === 'succeeded') {
        await db
          .from('fine_tuning_jobs')
          .update({
            status: 'trained',
            fine_tuned_model_id: result.fineTunedModelId,
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      } else if (result.status === 'failed') {
        await db
          .from('fine_tuning_jobs')
          .update({
            status: 'failed',
            rejected_reason: result.error ?? 'vendor reported failure',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }
      return c.json({ ok: true, data: result });
    } catch (e) {
      return c.json(
        {
          ok: false,
          error: { code: 'POLL_FAILED', message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }
  });

  // Vendor webhook (OpenAI today). We don't rely on it — `/poll` is the
  // source of truth — but when OpenAI supports signed webhooks it lets us
  // advance jobs without waiting for the next cron tick. Fails closed: if
  // `OPENAI_WEBHOOK_SECRET` is unset, any payload is rejected.
  app.post('/v1/webhooks/fine-tuning/openai', async (c) => {
    const secret = Deno.env.get('OPENAI_WEBHOOK_SECRET');
    if (!secret) {
      return c.json({ ok: false, error: { code: 'WEBHOOK_NOT_CONFIGURED' } }, 503);
    }
    const given = c.req.header('x-openai-signature') ?? '';
    // OpenAI will document the signing scheme once webhooks GA; until then we
    // enforce a constant-time equality on a shared secret in the header so
    // operators can pre-wire the route.
    let diff = secret.length ^ given.length;
    for (let i = 0, n = Math.max(secret.length, given.length); i < n; i++) {
      diff |= (secret.charCodeAt(i) || 0) ^ (given.charCodeAt(i) || 0);
    }
    if (diff !== 0) return c.json({ ok: false, error: { code: 'INVALID_SIGNATURE' } }, 401);

    type Evt = {
      type?: string;
      data?: {
        id?: string;
        fine_tuned_model?: string;
        status?: string;
        error?: { message?: string };
      };
    };
    const body = (await c.req.json().catch(() => ({}))) as Evt;
    const vendorJobId = body.data?.id;
    if (!vendorJobId) return c.json({ ok: false, error: { code: 'MISSING_JOB_ID' } }, 400);

    const db = getServiceClient();
    const { data: row } = await db
      .from('fine_tuning_jobs')
      .select('id')
      .eq('status', 'training')
      .filter('metrics->>vendor_job_id', 'eq', vendorJobId)
      .maybeSingle();
    if (!row) return c.json({ ok: true, data: { matched: false } });

    if (body.type === 'fine_tuning.job.succeeded' && body.data?.fine_tuned_model) {
      await db
        .from('fine_tuning_jobs')
        .update({
          status: 'trained',
          fine_tuned_model_id: body.data.fine_tuned_model,
          completed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } else if (
      body.type === 'fine_tuning.job.failed' ||
      body.type === 'fine_tuning.job.cancelled'
    ) {
      await db
        .from('fine_tuning_jobs')
        .update({
          status: 'failed',
          rejected_reason: body.data?.error?.message ?? body.type,
          completed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
    return c.json({ ok: true, data: { matched: true } });
  });

  // V5.3 §2.15 (B4): validate step — run eval over a held-out set.
  // The actual `predict` function depends on the trained model; here we delegate
  // to the project's currently-promoted classification path, which is enough
  // for a real correctness check before promotion.
  app.post('/v1/admin/fine-tuning/:id/validate', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    if (job.status !== 'trained' && job.status !== 'rejected') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_STATE',
            message: `Job is ${job.status}; validate only valid from trained/rejected`,
          },
        },
        409,
      );
    }

    await db.from('fine_tuning_jobs').update({ status: 'validating' }).eq('id', jobId);
    try {
      const { validateTrainedModel } = await import('../_shared/fine-tune.ts');
      const { resolveVendor, getAdapter } = await import('../_shared/fine-tune-vendor.ts');
      // Wave S5: use the real vendor adapter so a broken fine-tune is caught
      // here instead of being silently promoted. `stub:` base models keep the
      // old mirror-truth behaviour for deterministic tests.
      const vendor = resolveVendor(job.base_model);
      const adapter = getAdapter(vendor);
      const report = await validateTrainedModel(db, job, (s) => adapter.predict(job, s));
      await logAudit(
        db,
        job.project_id,
        userId,
        'settings.updated',
        'fine_tuning_validate',
        jobId,
        {
          passed: report.passed,
          accuracy: report.accuracy,
        },
      );
      return c.json({ ok: true, data: report });
    } catch (e) {
      await db
        .from('fine_tuning_jobs')
        .update({
          status: 'failed',
          rejected_reason: e instanceof Error ? e.message : String(e),
        })
        .eq('id', jobId);
      return c.json(
        {
          ok: false,
          error: { code: 'VALIDATE_FAILED', message: e instanceof Error ? e.message : String(e) },
        },
        500,
      );
    }
  });

  // V5.3 §2.15 (B4): promote step — swap the validated fine-tuned model into
  // project_settings.fine_tuned_stage{1,2}_model. Idempotent.
  app.post('/v1/admin/fine-tuning/:id/promote', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const body = await c.req.json().catch(() => ({}));
    const promoteToStage = body.promoteToStage ?? job.promote_to_stage;
    if (promoteToStage && promoteToStage !== job.promote_to_stage) {
      await db
        .from('fine_tuning_jobs')
        .update({ promote_to_stage: promoteToStage })
        .eq('id', jobId);
      job.promote_to_stage = promoteToStage;
    }

    const { promoteFineTunedModel } = await import('../_shared/fine-tune.ts');
    const result = await promoteFineTunedModel(db, job);
    if (!result.ok) {
      return c.json({ ok: false, error: { code: 'PROMOTE_FAILED', message: result.reason } }, 409);
    }

    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_promote', jobId, {
      stage: job.promote_to_stage,
      modelId: job.fine_tuned_model_id,
    });
    return c.json({
      ok: true,
      data: {
        promotedAt: result.promotedAt,
        stage: job.promote_to_stage,
        modelId: job.fine_tuned_model_id,
      },
    });
  });

  app.post('/v1/admin/fine-tuning/:id/reject', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();

    const { data: job } = await db
      .from('fine_tuning_jobs')
      .select('id, project_id, status')
      .eq('id', jobId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    await db
      .from('fine_tuning_jobs')
      .update({
        status: 'rejected',
        rejected_reason: body.reason ?? 'Rejected by admin',
      })
      .eq('id', jobId);
    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_reject', jobId, {
      reason: body.reason,
    });
    return c.json({ ok: true });
  });

  // Allow operators to nuke an aborted/stuck row (e.g. the three "pending" rows
  // created before the export pipeline was wired up). Safe to delete because
  // fine-tuning artifacts live in storage, not on this row.
  app.delete('/v1/admin/fine-tuning/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const jobId = c.req.param('id');
    const db = getServiceClient();

    const { data: job } = await db
      .from('fine_tuning_jobs')
      .select('id, project_id, status')
      .eq('id', jobId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', job.project_id)
      .eq('owner_id', userId)
      .single();
    if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const { error } = await db.from('fine_tuning_jobs').delete().eq('id', jobId);
    if (error) return dbError(c, error);

    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_delete', jobId, {
      previous_status: job.status,
    }).catch(() => {});
    return c.json({ ok: true });
  });

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
    const integrationType = c.req.param('type');
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

  // ----- Platform integrations (Sentry / Langfuse / GitHub) ---------------
  // These are V5.3 §2.18 first-party integrations. Unlike Jira/Linear (which
  // live in project_integrations as routing destinations), Sentry/Langfuse/GH
  // are observability/code surfaces that the LLM pipeline + fix-worker need
  // directly. They live in project_settings so the existing readers
  // (resolveLlmKey, fix-worker, fast-filter) pick them up without joins.

  const PLATFORM_KIND_FIELDS: Record<IntegrationKind, string[]> = {
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
  };

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
  const VAULTED_FIELDS_BY_KIND: Record<IntegrationKind, string[]> = {
    sentry: ['sentry_auth_token_ref', 'sentry_webhook_secret'],
    langfuse: ['langfuse_public_key_ref', 'langfuse_secret_key_ref'],
    github: ['github_installation_token_ref', 'github_webhook_secret', 'github_deploy_key'],
  };

  app.put('/v1/admin/integrations/platform/:kind', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind') as IntegrationKind;
    if (!INTEGRATION_KINDS.includes(kind)) {
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
          console.warn('[integrations] vault_store_secret failed; persisting raw value', {
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
    const reportId = c.req.param('reportId');
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    const { data: report } = await db
      .from('reports')
      .select('id, project_id, summary, description, category, severity, component')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .single();
    if (!report)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    const results = await createExternalIssue(db, report.project_id, {
      id: report.id,
      summary: report.summary ?? '',
      description: report.description ?? '',
      category: report.category,
      severity: report.severity ?? 'medium',
      component: report.component,
    });

    await logAudit(db, report.project_id, userId, 'integration.synced', 'report', reportId, {
      results,
    });
    return c.json({ ok: true, data: { synced: results } });
  });

  app.get('/v1/admin/plugins', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { plugins: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const plugins = await getActivePlugins(db, project.id);
    return c.json({ ok: true, data: { plugins } });
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
    const slug = c.req.param('slug');
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

  app.post('/v1/admin/synthetic', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const count = Math.min(body.count ?? 10, 50);
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-synthetic`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: project.id, count }),
    });
    const result = await res.json();
    return c.json({ ok: true, data: result.data });
  });

  app.get('/v1/admin/synthetic', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    const { data } = await db
      .from('synthetic_reports')
      .select(
        'id, project_id, generated_report, expected_classification, actual_classification, match_score, generated_at',
      )
      .in('project_id', projectIds)
      .order('generated_at', { ascending: false })
      .limit(50);
    return c.json({ ok: true, data: { reports: data ?? [] } });
  });

  // Async generation: enqueue a job, kick the worker fire-and-forget, return
  // the job id immediately. The page polls /v1/admin/intelligence/jobs and
  // shows a progress card. Avoids the 30s+ "spinner forever" symptom users hit
  // when the call was synchronous.
  app.post('/v1/admin/intelligence', jwtAuth, requireFeature('intelligence_reports'), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    // Wave S (2026-04-23): Intelligence reports run a multi-LLM pipeline
    // (stage1 classify → stage2 synthesize → summary). Even with the queue
    // de-dupe below, a scripted loop can still enqueue one job, cancel it,
    // enqueue the next, and drain Anthropic budget. 20 reports/hour is far
    // more than any human operator needs and cleanly rate-limits bots.
    {
      const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
        p_user_id: userId,
        p_scope: 'intelligence',
        p_max_per_window: 20,
        p_window: '1 hour',
      });
      if (rateErr) {
        const msg = rateErr.message ?? '';
        if (msg.includes('rate_limit_exceeded')) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'RATE_LIMITED',
                message: 'Intelligence report hourly limit reached (20/hour). Try again next hour.',
              },
            },
            429,
          );
        }
        console.warn('[intelligence] rate limit RPC failed:', msg);
      }
    }

    // De-dupe: if there's already a queued/running job for this user+project,
    // return it instead of stacking duplicates that would burn LLM credits.
    const { data: existing } = await db
      .from('intelligence_generation_jobs')
      .select('id, status')
      .eq('project_id', project.id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return c.json({ ok: true, data: { jobId: existing.id, deduplicated: true } });
    }

    const { data: job, error: insertErr } = await db
      .from('intelligence_generation_jobs')
      .insert({
        project_id: project.id,
        requested_by: userId,
        trigger: 'manual',
        status: 'queued',
      })
      .select('id')
      .single();
    if (insertErr || !job) {
      return dbError(c, insertErr ?? { message: 'Failed to enqueue' });
    }

    // Kick the worker without awaiting — it does its own status updates.
    // We deliberately don't `await` here so the user doesn't wait for the LLM.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceKey) {
      void (async () => {
        const startedAt = new Date().toISOString();
        await db
          .from('intelligence_generation_jobs')
          .update({ status: 'running', started_at: startedAt })
          .eq('id', job.id);
        try {
          const ctrl = new AbortController();
          // Hard ceiling so a misconfigured BYOK key never wedges the job row.
          const timeout = setTimeout(() => ctrl.abort(), 90_000);
          const res = await fetch(`${supabaseUrl}/functions/v1/intelligence-report`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectId: project.id, trigger: 'manual', jobId: job.id }),
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          const finishedAt = new Date().toISOString();
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            await db
              .from('intelligence_generation_jobs')
              .update({
                status: 'failed',
                error: errText.slice(0, 500),
                finished_at: finishedAt,
              })
              .eq('id', job.id);
            return;
          }
          const payload = await res.json().catch(() => ({}));
          const firstReportId = Array.isArray(payload?.data?.reportIds)
            ? (payload.data.reportIds[0] ?? null)
            : null;
          await db
            .from('intelligence_generation_jobs')
            .update({
              status: 'completed',
              report_id: firstReportId,
              finished_at: finishedAt,
            })
            .eq('id', job.id);
        } catch (err) {
          await db
            .from('intelligence_generation_jobs')
            .update({
              status: 'failed',
              error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
              finished_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        }
      })();
    }

    return c.json({ ok: true, data: { jobId: job.id } });
  });

  app.get('/v1/admin/intelligence/jobs', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { jobs: [] } });
    const { data } = await db
      .from('intelligence_generation_jobs')
      .select(
        'id, project_id, status, trigger, report_id, error, created_at, started_at, finished_at',
      )
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(20);
    return c.json({ ok: true, data: { jobs: data ?? [] } });
  });

  app.post(
    '/v1/admin/intelligence/jobs/:id/cancel',
    jwtAuth,
    requireFeature('intelligence_reports'),
    async (c) => {
      const userId = c.get('userId') as string;
      const id = c.req.param('id');
      const db = getServiceClient();
      const projectIds = await ownedProjectIds(db, userId);
      if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      const { data: job } = await db
        .from('intelligence_generation_jobs')
        .select('id, project_id, status')
        .eq('id', id)
        .maybeSingle();
      if (!job || !projectIds.includes(job.project_id)) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
      }
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return c.json(
          { ok: false, error: { code: 'TERMINAL', message: `Job is already ${job.status}` } },
          409,
        );
      }
      // We can't actually halt the in-flight LLM call (Supabase Edge Functions
      // don't expose process control), but flipping the row to cancelled stops
      // the UI from polling and prevents any further enqueue dedupe.
      await db
        .from('intelligence_generation_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', id);
      return c.json({ ok: true });
    },
  );

  // V5.3 §2.16 — list & download persisted intelligence reports.
  app.get('/v1/admin/intelligence', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [] } });

    const { data, error } = await db
      .from('intelligence_reports')
      .select(
        'id, project_id, week_start, summary_md, stats, benchmarks, llm_model, llm_tokens_in, llm_tokens_out, generated_by, created_at',
      )
      .in('project_id', projectIds)
      .order('week_start', { ascending: false })
      .limit(52);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { reports: data ?? [] } });
  });

  // Returns the rendered HTML so the admin client can pop it open in a new
  // window and use the browser's native print pipeline to save as PDF.
  app.get('/v1/admin/intelligence/:id/html', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No reports' } }, 404);

    const { data, error } = await db
      .from('intelligence_reports')
      .select('rendered_html, project_id')
      .eq('id', id)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!data || !projectIds.includes(data.project_id))
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Report not visible to caller' } },
        404,
      );

    return new Response(
      data.rendered_html ?? '<p>No rendered HTML available for this report.</p>',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; img-src data: https:;",
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  });

  // V5.3 §2.17 — Apache AGE parallel-write graph backend status & drift.
  app.get('/v1/admin/graph-backend/status', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: settings } = await db
      .from('project_settings')
      .select('graph_backend')
      .eq('project_id', project.id)
      .maybeSingle();

    const { data: ageAvail } = await db.rpc('mushi_age_available');

    const { data: latestAudit } = await db
      .from('age_drift_audit')
      .select('*')
      .eq('project_id', project.id)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: nodesUnsynced } = await db
      .from('graph_nodes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .is('age_synced_at', null);

    const { data: edgesUnsynced } = await db
      .from('graph_edges')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .is('age_synced_at', null);

    return c.json({
      ok: true,
      data: {
        backend: settings?.graph_backend ?? 'sql_only',
        ageAvailable: ageAvail === true,
        latestAudit,
        unsynced: {
          nodes: (nodesUnsynced as unknown as { count?: number } | null)?.count ?? null,
          edges: (edgesUnsynced as unknown as { count?: number } | null)?.count ?? null,
        },
      },
    });
  });

  app.post('/v1/admin/graph-backend/snapshot', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data, error } = await db.rpc('mushi_age_snapshot_drift', { p_project_id: project.id });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { auditId: data } });
  });

  // V5.3 §2.16 — privacy-preserving cross-customer benchmarking opt-in.
  app.put('/v1/admin/settings/benchmarking', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const optIn = body?.optIn === true;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { error } = await db
      .from('project_settings')
      .update({
        benchmarking_optin: optIn,
        benchmarking_optin_at: optIn ? new Date().toISOString() : null,
        benchmarking_optin_by: optIn ? userId : null,
      })
      .eq('project_id', project.id);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { optIn } });
  });

  // ============================================================
  // Admin: telemetry & operational health
  // ============================================================

  app.get('/v1/admin/health/llm', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: ownedProjects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = (ownedProjects ?? []).map((p) => p.id);

    const windowParam = c.req.query('window') ?? '24h';
    const windowMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const ms = windowMs[windowParam] ?? windowMs['24h'];

    if (projectIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          window: windowParam,
          totalCalls: 0,
          fallbacks: 0,
          fallbackRate: 0,
          errors: 0,
          errorRate: 0,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          byModel: {},
          byFunction: {},
          recent: [],
        },
      });
    }

    const since = new Date(Date.now() - ms).toISOString();
    const { data: invocations } = await db
      .from('llm_invocations')
      .select(
        'function_name, used_model, primary_model, fallback_used, status, latency_ms, input_tokens, output_tokens, cost_usd, created_at, langfuse_trace_id, report_id, key_source',
      )
      .in('project_id', projectIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);

    const rows = invocations ?? [];
    const totalCalls = rows.length;
    const fallbacks = rows.filter((r) => r.fallback_used).length;
    const errors = rows.filter((r) => r.status !== 'success').length;
    const avgLatency =
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / rows.length)
        : 0;

    // Per-function p95 + a global p95. Sort once, slice index = floor(0.95 * len).
    const sortedGlobal = rows.map((r) => r.latency_ms ?? 0).sort((a, b) => a - b);
    const p95Latency =
      sortedGlobal.length > 0
        ? (sortedGlobal[
            Math.min(sortedGlobal.length - 1, Math.floor(sortedGlobal.length * 0.95))
          ] ?? 0)
        : 0;

    const byModel: Record<string, { calls: number; errors: number; tokens: number }> = {};
    const byFunction: Record<
      string,
      {
        calls: number;
        errors: number;
        fallbacks: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
        costUsd: number;
        lastFailureAt: string | null;
      }
    > = {};
    const fnLatency: Record<string, number[]> = {};
    for (const r of rows) {
      const modelKey = r.used_model;
      byModel[modelKey] ??= { calls: 0, errors: 0, tokens: 0 };
      byModel[modelKey].calls += 1;
      if (r.status !== 'success') byModel[modelKey].errors += 1;
      byModel[modelKey].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);

      const fnKey = r.function_name;
      byFunction[fnKey] ??= {
        calls: 0,
        errors: 0,
        fallbacks: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        costUsd: 0,
        lastFailureAt: null,
      };
      const fnAgg = byFunction[fnKey];
      fnAgg.calls += 1;
      if (r.status !== 'success') {
        fnAgg.errors += 1;
        // Track the most recent failure timestamp so the FE can render
        // "last failure 12m ago" without a second query.
        if (!fnAgg.lastFailureAt || r.created_at > fnAgg.lastFailureAt) {
          fnAgg.lastFailureAt = r.created_at as string;
        }
      }
      if (r.fallback_used) fnAgg.fallbacks += 1;
      // Prefer the persisted cost_usd column Fall back to the
      // shared estimator for ancient rows the backfill missed.
      fnAgg.costUsd +=
        r.cost_usd != null
          ? Number(r.cost_usd)
          : estimateCallCostUsd(r.used_model, r.input_tokens ?? 0, r.output_tokens ?? 0);
      fnLatency[fnKey] ??= [];
      fnLatency[fnKey].push(r.latency_ms ?? 0);
    }
    for (const fn of Object.keys(byFunction)) {
      const arr = fnLatency[fn].slice().sort((a, b) => a - b);
      byFunction[fn].avgLatencyMs =
        arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
      byFunction[fn].p95LatencyMs =
        arr.length > 0 ? (arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] ?? 0) : 0;
      byFunction[fn].costUsd = Math.round(byFunction[fn].costUsd * 10000) / 10000;
    }

    return c.json({
      ok: true,
      data: {
        window: windowParam,
        totalCalls,
        fallbacks,
        fallbackRate: totalCalls > 0 ? fallbacks / totalCalls : 0,
        errors,
        errorRate: totalCalls > 0 ? errors / totalCalls : 0,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        byModel,
        byFunction,
        recent: rows.slice(0, 100),
      },
    });
  });

  app.get('/v1/admin/health/cron', jwtAuth, async (c) => {
    const db = getServiceClient();
    const { data: runs } = await db
      .from('cron_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);

    const byJob: Record<
      string,
      {
        lastRun: string | null;
        lastStatus: string | null;
        successRate: number;
        avgDurationMs: number;
        runs: number;
        /** Minutes since last run; null when the job has never executed. */
        stalenessMinutes: number | null;
        /** Staleness tier for the UI: `ok` (within expected cadence),
         *  `warn` (up to 3x expected), `stale` (beyond 3x), `never` (no run on record). */
        staleness: 'ok' | 'warn' | 'stale' | 'never';
      }
    > = {};

    // Expected cadences in minutes. Any job we don't know about defaults to
    // 24h (day-scale), which keeps the probe conservative for new crons.
    const EXPECTED_CADENCE_MIN: Record<string, number> = {
      'judge-batch': 60,
      'intelligence-report': 60 * 24 * 7,
      'data-retention': 60 * 24,
      'pipeline-recovery': 5,
      'repo-indexer': 60 * 24,
      'seer-poller': 15,
      'ci-sync': 60,
    };
    const now = Date.now();
    const rowsOrEmpty = runs ?? [];

    for (const r of rowsOrEmpty) {
      byJob[r.job_name] ??= {
        lastRun: null,
        lastStatus: null,
        successRate: 0,
        avgDurationMs: 0,
        runs: 0,
        stalenessMinutes: null,
        staleness: 'never',
      };
      const j = byJob[r.job_name];
      if (!j.lastRun) {
        j.lastRun = r.started_at;
        j.lastStatus = r.status;
      }
      j.runs += 1;
    }
    for (const job of Object.keys(byJob)) {
      const jobRuns = rowsOrEmpty.filter((r) => r.job_name === job);
      const successes = jobRuns.filter((r) => r.status === 'success').length;
      byJob[job].successRate = jobRuns.length > 0 ? successes / jobRuns.length : 0;
      const durations = jobRuns.map((r) => r.duration_ms ?? 0).filter((d) => d > 0);
      byJob[job].avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;
      // Staleness: how long since the most recent run compared to the
      // expected cadence. This lets the UI surface "judge-batch hasn't run
      // in 6h" without every page having to hard-code cadences.
      const lastRunIso = byJob[job].lastRun;
      if (lastRunIso) {
        const ageMin = Math.max(0, Math.round((now - new Date(lastRunIso).getTime()) / 60_000));
        const expected = EXPECTED_CADENCE_MIN[job] ?? 60 * 24;
        byJob[job].stalenessMinutes = ageMin;
        byJob[job].staleness =
          ageMin <= expected ? 'ok' : ageMin <= expected * 3 ? 'warn' : 'stale';
      }
    }

    return c.json({ ok: true, data: { byJob, recent: rowsOrEmpty.slice(0, 30) } });
  });

  // Wave T.5.8a: unified chart-annotation feed. Reads the admin_chart_events
  // view (deploys, non-success cron ticks, BYOK rotations) within the
  // requested window and kind filter. Output is capped at 200 events to
  // keep the overlay snappy on long time ranges; UIs can narrow the
  // window or `kinds` filter to see more.
  app.get('/v1/admin/chart-events', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const url = new URL(c.req.url);
    const projectIdRaw = url.searchParams.get('project_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const kindsParam = url.searchParams.get('kinds');
    const allowedKinds = new Set(['deploy', 'cron', 'byok']);
    const kinds = (kindsParam ?? 'deploy,cron,byok')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => allowedKinds.has(k));
    if (kinds.length === 0) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_INPUT', message: 'kinds[] must include one of deploy/cron/byok' },
        },
        400,
      );
    }

    // Authorization: scope strictly to projects this user owns. The service
    // client bypasses RLS, and `admin_chart_events` is `SECURITY INVOKER` so
    // RLS only protects callers who use the user JWT — which we do not. We
    // therefore enforce ownership ourselves by computing the owned project
    // ids and filtering with `.in('project_id', ...)`. Global rows (cron
    // ticks with NULL project_id) are still surfaced because they don't
    // belong to any specific tenant.
    const db = getServiceClient();
    const { data: ownedProjects } = await db.from('projects').select('id').eq('owner_id', userId);
    const ownedIds = (ownedProjects ?? []).map((p) => p.id as string);

    // Validate the optional caller-supplied `project_id` filter as a UUID
    // before threading it into the query — both to reject obvious garbage
    // and to defuse PostgREST `.or()` filter-string injection (commas /
    // dots in a raw value can broaden the filter beyond ownership).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let projectFilter: string[] | null = null;
    if (projectIdRaw) {
      if (!UUID_RE.test(projectIdRaw)) {
        return c.json(
          { ok: false, error: { code: 'INVALID_INPUT', message: 'project_id must be a UUID' } },
          400,
        );
      }
      if (!ownedIds.includes(projectIdRaw)) {
        return c.json(
          { ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } },
          403,
        );
      }
      projectFilter = [projectIdRaw];
    } else {
      projectFilter = ownedIds;
    }

    let query = db
      .from('admin_chart_events')
      .select('occurred_at, kind, label, href, project_id')
      .in('kind', kinds)
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (from) query = query.gte('occurred_at', from);
    if (to) query = query.lte('occurred_at', to);
    // Owned rows OR globally-scoped rows (project_id IS NULL — deploy /
    // cron events that aren't tenant-specific). When the user owns no
    // projects, only the global rows are visible.
    if (projectFilter.length > 0) {
      const idList = projectFilter.map((id) => `"${id}"`).join(',');
      query = query.or(`project_id.in.(${idList}),project_id.is.null`);
    } else {
      query = query.is('project_id', null);
    }

    const { data, error } = await query;
    if (error) return dbError(c, error);

    return c.json({
      ok: true,
      data: {
        events: (data ?? []).map((e) => ({
          occurred_at: e.occurred_at,
          kind: e.kind,
          label: e.label,
          href: e.href ?? null,
          project_id: e.project_id ?? null,
        })),
      },
    });
  });

  app.post('/v1/admin/health/cron/:job/trigger', jwtAuth, async (c) => {
    const job = c.req.param('job');
    const allowed = ['judge-batch', 'intelligence-report'] as const;
    if (!allowed.includes(job as (typeof allowed)[number])) {
      return c.json(
        { ok: false, error: { code: 'UNKNOWN_JOB', message: `Unknown job: ${job}` } },
        400,
      );
    }
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${job}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: project.id, trigger: 'manual' }),
    });
    const result = await res.json().catch(() => ({}));
    return c.json({ ok: res.ok, data: result.data ?? result });
  });
}
