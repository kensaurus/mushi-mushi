import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import type { ExportSampleRow } from '../../_shared/fine-tune.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, callerProjectIds, resolveOwnedProject, userCanAccessProject } from '../shared.ts';

export function registerFineTuningRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/fine-tuning', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job, error: loadErr } = await db
      .from('fine_tuning_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (loadErr || !job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
      const result = await adapter.poll(db, job);

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
    if (!secret?.trim()) {
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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
      const report = await validateTrainedModel(db, job, (s: ExportSampleRow) => adapter.predict(db, job, s));
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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
    const jobId = c.req.param('id')!;
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();

    const { data: job } = await db
      .from('fine_tuning_jobs')
      .select('id, project_id, status')
      .eq('id', jobId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

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
    const jobId = c.req.param('id')!;
    const db = getServiceClient();

    const { data: job } = await db
      .from('fine_tuning_jobs')
      .select('id, project_id, status')
      .eq('id', jobId)
      .single();
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Fine-tuning state transitions are mutations — require an
    // owner/admin role on the project's org (or legacy direct ownership).
    const access = await userCanAccessProject(db, userId, job.project_id);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

    const { error } = await db.from('fine_tuning_jobs').delete().eq('id', jobId);
    if (error) return dbError(c, error);

    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_delete', jobId, {
      previous_status: job.status,
    }).catch(() => {});
    return c.json({ ok: true });
  });

}
