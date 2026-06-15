/**
 * FILE: packages/server/supabase/functions/api/routes/reporter-feature-board.ts
 * PURPOSE: Reporter-auth feature board for the embedded SDK widget.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError, jsonError, jsonOk } from '../shared.ts';

type ReporterAuth = { ok: true; tokenHash: string } | { ok: false; status: number; code: string; message: string };

export function registerReporterFeatureBoardRoutes(
  app: Hono<{ Variables: Variables }>,
  resolveReporterTokenHash: (
    c: import('npm:hono@4').Context,
    projectId: string,
  ) => Promise<ReporterAuth>,
): void {
  app.get('/v1/reporter/feature-board', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return jsonError(c, auth.code, auth.message, auth.status as 400 | 401);

    const db = getServiceClient();
    // Curated PII-free projection: the widget runs in untrusted end-user
    // browsers, so never ship user_email / user_id / admin_response to it.
    const { data: tickets, error } = await db
      .from('feature_requests_with_stats')
      .select('id, subject, body, status, vote_count, comment_count, created_at, shipped_at, shipped_note')
      .eq('project_id', projectId)
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return dbError(c, error);

    const { data: myVotes } = await db
      .from('feature_request_reporter_votes')
      .select('request_id')
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash);

    const voted = new Set((myVotes ?? []).map((v) => v.request_id));

    return jsonOk(c, {
      tickets: (tickets ?? []).map((t) => ({
        ...t,
        my_vote: voted.has(t.id),
        status_label: t.shipped_at ? 'shipped' : t.status,
      })),
    });
  });

  app.post('/v1/reporter/feature-board/:id/vote', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const requestId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return jsonError(c, auth.code, auth.message, auth.status as 400 | 401);

    const db = getServiceClient();
    const { data: ticket, error: fetchErr } = await db
      .from('support_tickets')
      .select('id, project_id, category')
      .eq('id', requestId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (fetchErr) return dbError(c, fetchErr);
    if (!ticket) return jsonError(c, 'NOT_FOUND', 'Feature request not found', 404);
    if (ticket.category !== 'feature') {
      return jsonError(c, 'INVALID_CATEGORY', 'Only feature tickets can be voted on', 400);
    }

    const { data: existing } = await db
      .from('feature_request_reporter_votes')
      .select('id')
      .eq('request_id', requestId)
      .eq('reporter_token_hash', auth.tokenHash)
      .maybeSingle();

    if (existing) {
      const { error: delErr } = await db
        .from('feature_request_reporter_votes')
        .delete()
        .eq('id', existing.id);
      if (delErr) return dbError(c, delErr);
      return jsonOk(c, { voted: false, action: 'removed' });
    }

    const { error: insErr } = await db.from('feature_request_reporter_votes').insert({
      request_id: requestId,
      project_id: projectId,
      reporter_token_hash: auth.tokenHash,
    });
    if (insErr?.code === '23505') {
      return jsonOk(c, { voted: true, action: 'already_voted' });
    }
    if (insErr) return dbError(c, insErr);

    return jsonOk(c, { voted: true, action: 'added' });
  });
}
