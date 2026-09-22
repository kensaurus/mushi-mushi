/**
 * FILE: packages/server/supabase/functions/api/routes/lifecycle-emails.ts
 * PURPOSE: Console toggle for the lifecycle (setup) emails —
 *          GET|PUT /v1/admin/me/lifecycle-emails. Backs the notifications
 *          switch in /settings. The signed one-click unsubscribe link lives
 *          in routes/public.ts (GET|POST /v1/public/email/unsubscribe).
 *
 * State = presence of a lifecycle_email_optout row for the caller
 * (service role only; see 20260921000005_lifecycle_emails.sql).
 */

import type { Hono } from 'npm:hono@4';
import { z } from 'npm:zod@3';
import type { Variables } from '../types.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError } from '../shared.ts';

const bodySchema = z.object({ enabled: z.boolean() }).strict();

export function registerLifecycleEmailRoutes(app: Hono<{ Variables: Variables }>): void {
  // GET /v1/admin/me/lifecycle-emails → { enabled }
  app.get('/v1/admin/me/lifecycle-emails', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data, error } = await db
      .from('lifecycle_email_optout')
      .select('user_id, at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return dbError(c, error);
    return c.json({
      ok: true,
      data: { enabled: !data, opted_out_at: (data?.at as string | undefined) ?? null },
    });
  });

  // PUT /v1/admin/me/lifecycle-emails { enabled: boolean } → { enabled }
  app.put('/v1/admin/me/lifecycle-emails', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const raw = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'body must be { enabled: boolean }' } },
        400,
      );
    }
    const db = getServiceClient();
    if (parsed.data.enabled) {
      const { error } = await db.from('lifecycle_email_optout').delete().eq('user_id', userId);
      if (error) return dbError(c, error);
    } else {
      const { error } = await db
        .from('lifecycle_email_optout')
        .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (error) return dbError(c, error);
    }
    return c.json({ ok: true, data: { enabled: parsed.data.enabled } });
  });
}
