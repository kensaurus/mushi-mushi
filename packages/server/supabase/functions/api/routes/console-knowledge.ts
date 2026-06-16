/**
 * FILE: api/routes/console-knowledge.ts
 * PURPOSE: Admin API for the global console help knowledge index.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError } from '../shared.ts';

export function registerConsoleKnowledgeRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/console-knowledge/status', jwtAuth, async (c) => {
    const db = getServiceClient();
    const { count, error } = await db
      .from('console_knowledge_chunks')
      .select('id', { count: 'exact', head: true });
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return c.json({ ok: true, data: { chunkCount: 0, schemaPending: true } });
      }
      return dbError(c, error);
    }
    const { data: latest } = await db
      .from('console_knowledge_chunks')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return c.json({
      ok: true,
      data: {
        chunkCount: count ?? 0,
        lastUpdated: latest?.updated_at ?? null,
        schemaPending: false,
      },
    });
  });

  app.post('/v1/admin/console-knowledge/rebuild', jwtAuth, async (c) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        { ok: false, error: { code: 'MISCONFIGURED', message: 'Server missing Supabase env' } },
        500,
      );
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/console-knowledge-build`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const payload = await res.json().catch(() => ({})) as { ok?: boolean; data?: { upserted?: number } }
    if (!res.ok) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'BUILD_FAILED',
            message: (payload as { error?: string }).error ?? `HTTP ${res.status}`,
          },
        },
        502,
      )
    }
    const inner = payload.ok === true && payload.data ? payload.data : payload
    return c.json({ ok: true, data: inner })
  });
}
