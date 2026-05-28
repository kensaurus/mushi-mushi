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
import { currentRegion, lookupProjectRegion, regionEndpoint } from '../../_shared/region.ts';
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

export function registerCodebaseRoutes(app: Hono): void {
  // ============================================================
  // CODEBASE INDEXER (V5.3 §2.3.4) — non-GitHub fallback for `mushi index`
  // Auth: project API key. Each call uploads ONE source file; server chunks +
  // embeds + upserts. Designed for low-throughput CLI use; high-throughput
  // indexing should use the GitHub App webhook path.
  // ============================================================

  app.post('/v1/admin/codebase/upload', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      filePath?: string;
      source?: string;
    };
    if (!body.filePath || !body.source) {
      return c.json(
        { ok: false, error: { code: 'MISSING_FIELDS', message: 'filePath and source required' } },
        400,
      );
    }
    if (body.projectId && body.projectId !== projectId) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PROJECT_MISMATCH',
            message: 'API key project does not match body projectId',
          },
        },
        403,
      );
    }
    if (body.source.length > 500_000) {
      return c.json(
        { ok: false, error: { code: 'TOO_LARGE', message: 'Source > 500KB; skip large files' } },
        413,
      );
    }

    const { chunk, shouldIndex, sha256Hex } = await import('../_shared/code-indexer.ts');
    const { createEmbedding } = await import('../_shared/embeddings.ts');

    if (!shouldIndex(body.filePath)) {
      return c.json({ ok: true, chunks: 0, skipped: 'unsupported_extension' });
    }

    const db = getServiceClient();
    const chunks = chunk(body.filePath, body.source);
    let inserted = 0;
    for (const ch of chunks) {
      try {
        const text = `${body.filePath}::${ch.symbolName ?? 'whole'}\n${ch.body}`;
        const embedding = await createEmbedding(text, { projectId });
        const contentHash = await sha256Hex(ch.body);
        await db.from('project_codebase_files').upsert(
          {
            project_id: projectId,
            file_path: body.filePath,
            symbol_name: ch.symbolName,
            signature: ch.signature,
            line_start: ch.lineStart,
            line_end: ch.lineEnd,
            language: ch.language,
            content_hash: contentHash,
            content_preview: ch.body.slice(0, 600),
            embedding,
            embedding_model: 'text-embedding-3-small',
            last_modified: new Date().toISOString(),
            tombstoned_at: null,
          },
          { onConflict: 'project_id,file_path,symbol_name' },
        );
        inserted++;
      } catch (err) {
        // best-effort per chunk; continue
        console.warn('chunk upload failed', String(err));
      }
    }
    return c.json({ ok: true, chunks: inserted });
  });
}
