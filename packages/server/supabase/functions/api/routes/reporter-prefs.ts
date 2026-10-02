/**
 * FILE: packages/server/supabase/functions/api/routes/reporter-prefs.ts
 * PURPOSE: A reporter's opt-in channels (Plan 018 §4.1, §6.2).
 *
 * Routes (apiKeyAuth + reporter token):
 *   GET    /v1/reporter/notification-prefs      masked address, channels, what this app offers
 *   PUT    /v1/reporter/notification-prefs      { email?, channels? } — a new address gets a confirmation mail
 *   POST   /v1/reporter/push-subscriptions      { endpoint, keys } — ADR 0012 endpoint allow-list
 *   DELETE /v1/reporter/push-subscriptions      { endpoint }
 *
 * Public (no headers — opened from an email):
 *   GET|POST /v1/public/reporter/email/verify?t=       double opt-in
 *   GET|POST /v1/public/reporter/email/unsubscribe?t=  one-click unsubscribe (RFC 8058)
 *
 * GET only renders a page with a button; POST writes. Mail scanners and link
 * previewers fetch URLs on their own, and a write on GET would confirm or
 * unsubscribe people who never clicked. Mail clients send the RFC 8058
 * one-click POST (`List-Unsubscribe=One-Click`) to the same URL; the body is
 * not needed, the token in the URL is the credential.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import {
  removeReporterPushSubscription,
  reporterPrefsView,
  saveReporterPushSubscription,
  unsubscribeReporterEmail,
  updateReporterPrefs,
  verifyReporterEmail,
} from '../../_shared/reporter-optin.ts';
import { sha256Hex } from '../../_shared/reporter-email.ts';
import { dbError, jsonError } from '../shared.ts';
import type { ReporterAuth } from './reporter-auth.ts';

const prefsLog = log.child('reporter-prefs');

/** Verification mails a project may trigger per hour (one bad actor cycling reporter tokens). */
const VERIFY_PER_PROJECT_PER_HOUR = 60;
/** Push subscription writes per reporter per hour. */
const PUSH_WRITES_PER_HOUR = 20;

async function actorUuid(scope: string, key: string): Promise<string> {
  const hex = (await sha256Hex(`${scope}:${key}`)).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** scoped_rate_limit_claim; fails CLOSED on an unexpected RPC error (public write route). */
async function claim(scope: string, key: string, max: number): Promise<'ok' | 'limit' | 'error'> {
  const { error } = await getServiceClient().rpc('scoped_rate_limit_claim', {
    p_user_id: await actorUuid(scope, key),
    p_scope: scope,
    p_max_per_window: max,
    p_window: '1 hour',
  });
  if (!error) return 'ok';
  if ((error.message ?? '').includes('rate_limit_exceeded')) return 'limit';
  prefsLog.error('rate limit check failed — failing closed', { scope, err: error.message });
  return 'error';
}

function authFailure(c: Context, auth: Extract<ReporterAuth, { ok: false }>): Response {
  return c.json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status as 400 | 401);
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

const page = (title: string, body: string, formHtml = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#18181b;line-height:1.5"><h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${formHtml}</body></html>`;

const button = (action: string, label: string) =>
  `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="font:inherit;padding:8px 16px;border-radius:6px;border:1px solid #18181b;background:#18181b;color:#fff;cursor:pointer">${escapeHtml(label)}</button></form>`;

function appName(name: string | null): string {
  return name?.trim() || 'the app';
}

export function registerReporterPrefsRoutes(
  app: Hono<{ Variables: Variables }>,
  resolveReporterTokenHash: (c: Context, projectId: string) => Promise<ReporterAuth>,
): void {
  app.get('/v1/reporter/notification-prefs', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, data: await reporterPrefsView(getServiceClient(), projectId, auth.tokenHash) });
  });

  app.put('/v1/reporter/notification-prefs', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);
    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);

    if (typeof body.email === 'string' && body.email.trim()) {
      const limited = await claim('reporter_email_verify', projectId, VERIFY_PER_PROJECT_PER_HOUR);
      if (limited !== 'ok') {
        return c.json(
          { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many confirmation emails right now. Try again later.' } },
          limited === 'limit' ? 429 : 503,
        );
      }
    }

    const channels = body.channels && typeof body.channels === 'object' ? (body.channels as Record<string, unknown>) : undefined;
    const result = await updateReporterPrefs(getServiceClient(), projectId, auth.tokenHash, {
      email: body.email,
      channels: channels ? { email: channels.email, push: channels.push } : undefined,
    });
    if (!result.ok) {
      return c.json(
        { ok: false, error: { code: result.code, message: result.message, ...(result.reason ? { reason: result.reason } : {}) } },
        result.status,
      );
    }
    return c.json({ ok: true, data: { ...result.view, verification_sent: result.verification_sent } });
  });

  app.post('/v1/reporter/push-subscriptions', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);
    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);
    const limited = await claim('reporter_push_write', `${projectId}:${auth.tokenHash}`, PUSH_WRITES_PER_HOUR);
    if (limited !== 'ok') {
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, limited === 'limit' ? 429 : 503);
    }
    const result = await saveReporterPushSubscription(
      getServiceClient(),
      projectId,
      auth.tokenHash,
      { endpoint: body.endpoint, keys: (body.keys ?? undefined) as { p256dh?: unknown; auth?: unknown } | undefined },
      c.req.header('user-agent') ?? null,
    );
    if (!result.ok) {
      return c.json(
        { ok: false, error: { code: result.code, message: result.message, ...(result.reason ? { reason: result.reason } : {}) } },
        result.status,
      );
    }
    return c.json({ ok: true, data: { subscribed: true } });
  });

  app.delete('/v1/reporter/push-subscriptions', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);
    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);
    const result = await removeReporterPushSubscription(getServiceClient(), projectId, auth.tokenHash, body.endpoint);
    if (!result.ok) {
      if (result.code === 'DB_ERROR') return dbError(c, { message: result.message });
      return jsonError(c, result.code, result.message, result.status);
    }
    return c.json({ ok: true, data: { removed: result.removed } });
  });

  // ── Links opened from an email ────────────────────────────────────────────

  const invalidLink = (c: Context) =>
    c.html(page('This link is not valid', 'It may have been cut off by your mail client, or it was already replaced by a newer email.'), 400);

  app.get('/v1/public/reporter/email/verify', (c) => {
    const token = c.req.query('t') ?? '';
    if (!token) return invalidLink(c);
    return c.html(
      page(
        'Confirm your email',
        'You asked to get email updates about a report you sent. Confirm to start getting them.',
        button(`?t=${encodeURIComponent(token)}`, 'Confirm'),
      ),
    );
  });

  app.post('/v1/public/reporter/email/verify', async (c) => {
    const result = await verifyReporterEmail(getServiceClient(), c.req.query('t'));
    if (!result.ok) {
      if (result.code === 'EXPIRED') {
        return c.html(page('This link has expired', 'Ask for email updates again in the app to get a new link.'), 410);
      }
      if (result.code === 'DB_ERROR') return c.html(page('Something went wrong', 'Please try the link again in a minute.'), 500);
      return invalidLink(c);
    }
    return c.html(
      page(
        "You're all set",
        `You'll get an email from ${appName(result.appName)} when one of your reports has news. Every email has a link to stop them.`,
      ),
    );
  });

  app.get('/v1/public/reporter/email/unsubscribe', (c) => {
    const token = c.req.query('t') ?? '';
    if (!token) return invalidLink(c);
    return c.html(
      page(
        'Stop email updates?',
        'You will stop getting emails about your reports. Updates still show in the app.',
        button(`?t=${encodeURIComponent(token)}`, 'Stop emails'),
      ),
    );
  });

  app.post('/v1/public/reporter/email/unsubscribe', async (c) => {
    const result = await unsubscribeReporterEmail(getServiceClient(), c.req.query('t'));
    if (!result.ok) {
      if (result.code === 'DB_ERROR') return c.html(page('Something went wrong', 'Please try the link again in a minute.'), 500);
      return invalidLink(c);
    }
    return c.html(
      page(
        "You're unsubscribed",
        `No more emails from ${appName(result.appName)} about your reports. You can still see updates in the app.`,
      ),
    );
  });
}
