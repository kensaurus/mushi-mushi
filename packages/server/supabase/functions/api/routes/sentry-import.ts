/**
 * FILE: sentry-import.ts
 * PURPOSE: POST /v1/admin/projects/:id/sentry/import — pull existing Sentry
 *          issues into the report queue (the webhook only sees new ones).
 *
 * Body: { issueIds?: string[] (≤10, ids or short ids), query?: string, limit?: 1-10,
 *         sinceDays?: 1-90, cursor?: string, sentryProject?: slug }
 * With neither issueIds nor query, imports the newest `is:unresolved` issues.
 * A search answers `nextCursor`; send it back as `cursor` for the next ≤10.
 * `sentryProject` picks one of the project's Sentry projects (primary
 * `sentry_project_slug` by default, or one of `sentry_extra_project_slugs`).
 *
 * Reuses ingestSentryError, so dedupe, report_external_issues linking and
 * classification match a webhook delivery. Stack-frame files from the
 * imported events are queued for targeted indexing so the fix context can
 * reach the file the error came from.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { log as rootLog } from '../../_shared/logger.ts';
import { callerCanAccessProject } from '../shared.ts';
import { triggerClassification } from '../helpers.ts';
import {
  allowedSentryProjectSlugs,
  importSentryIssues,
  parseSentryImportRequest,
  resolveSentrySearch,
} from '../../_shared/sentry-import.ts';
import { SentryApiError } from '../../_shared/sentry-api.ts';
import { resolveAndDereferencePlatformSettings } from '../../_shared/integration-settings.ts';

const log = rootLog.child('sentry-import');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Index the imported stacks' files now instead of waiting for the next
 *  sweep. Fire-and-forget; the indexer bounds the work. */
function queueFramePathIndexing(projectId: string, paths: string[]): boolean {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const internalSecret =
    Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !internalSecret || paths.length === 0) return false;
  const run = fetch(`${supabaseUrl}/functions/v1/webhooks-github-indexer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${internalSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'sweep', project_id: projectId, frame_paths: paths }),
    signal: AbortSignal.timeout(150_000),
  })
    .then(async (res) => {
      if (!res.ok) {
        log.warn('frame-path indexing kick failed', { projectId, status: res.status });
      }
    })
    .catch((err) => log.warn('frame-path indexing kick failed', { projectId, err: String(err) }));
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(run);
  return true;
}

export function registerSentryImportRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/projects/:id/sentry/import', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const projectId = c.req.param('id')!;
    if (!UUID_RE.test(projectId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project id must be a UUID' } }, 400);
    }
    const db = getServiceClient();
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403);
    }
    if (access.role === 'viewer') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot import Sentry issues' } }, 403);
    }

    const parsed = parseSentryImportRequest(await c.req.json().catch(() => ({})));
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);

    const [{ settings }, projectSettings] = await Promise.all([
      resolveAndDereferencePlatformSettings(db, projectId),
      loadSentryProjectSlugs(db, projectId),
    ]);
    const orgSlug = settings.sentry_org_slug ?? null;
    const token = settings.sentry_auth_token_ref ?? null;
    const projectSlugs = allowedSentryProjectSlugs(
      projectSettings?.sentry_project_slug,
      projectSettings?.sentry_extra_project_slugs,
    );
    const missing = [
      !orgSlug ? 'org slug' : null,
      projectSlugs.length === 0 ? 'project slug' : null,
      !token ? 'auth token' : null,
    ].filter(Boolean);
    if (missing.length > 0 || !orgSlug || projectSlugs.length === 0 || !token) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SENTRY_NOT_CONFIGURED',
            message: `Set the Sentry ${missing.join(', ')} in Integrations → Sentry before importing.`,
          },
        },
        400,
      );
    }

    if (!parsed.value.issueIds) {
      const search = resolveSentrySearch(parsed.value, projectSlugs);
      if (!search.ok) return c.json({ ok: false, error: search.error }, 400);
    }

    let result: Awaited<ReturnType<typeof importSentryIssues>>;
    try {
      result = await importSentryIssues(db, {
        projectId,
        request: parsed.value,
        sentry: { token, orgSlug, projectSlugs },
        triggerClassification,
      });
    } catch (err) {
      const status = err instanceof SentryApiError ? err.status : 0;
      log.warn('Sentry import failed', { projectId, status, err: String(err).slice(0, 200) });
      return c.json(
        {
          ok: false,
          error: {
            code: 'SENTRY_UPSTREAM',
            message:
              status === 401 || status === 403
                ? 'Sentry refused the token. It needs event:read and project:read.'
                : 'Could not search Sentry issues. Check the org and project slug.',
          },
        },
        502,
      );
    }

    const indexingQueued = queueFramePathIndexing(projectId, result.framePaths);
    const created = result.items.filter((i) => i.outcome === 'created').map((i) => i.reportId);
    const linked = result.items
      .filter((i) => i.outcome !== 'created' && i.outcome !== 'error' && i.reportId)
      .map((i) => i.reportId);
    return c.json({
      ok: true,
      data: {
        items: result.items,
        created,
        linked,
        failed: result.items.filter((i) => i.outcome === 'error').length,
        indexing: { queued: indexingQueued, paths: result.framePaths.length },
        sentryProject: result.sentryProject,
        sentryProjects: projectSlugs,
        nextCursor: result.nextCursor,
      },
    });
  });
}

/**
 * `sentry_extra_project_slugs` arrives with migration 20261002135500. If the
 * api deploys first, read the single slug instead of failing every import.
 */
async function loadSentryProjectSlugs(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<{ sentry_project_slug?: string | null; sentry_extra_project_slugs?: unknown } | null> {
  const full = await db
    .from('project_settings')
    .select('sentry_project_slug, sentry_extra_project_slugs')
    .eq('project_id', projectId)
    .maybeSingle();
  if (!full.error) return full.data;
  log.warn('sentry_extra_project_slugs unreadable; using the single slug', { projectId, err: full.error.message });
  const single = await db.from('project_settings').select('sentry_project_slug').eq('project_id', projectId).maybeSingle();
  return single.data;
}
