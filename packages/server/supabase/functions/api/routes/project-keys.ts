import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { dbError, userCanAccessProject } from '../shared.ts';

export function registerProjectKeysRoutes(app: Hono<{ Variables: Variables }>): void {
  // Scopes vocabulary is enforced at the DB level (CHECK constraint from
  // migration 20260421003000_api_key_scopes.sql). We echo it here so the API
  // rejects bad input with a 400 and a helpful message, rather than letting
  // Postgres surface a noisy `23514` error.
  const ALLOWED_KEY_SCOPES = ['report:write', 'mcp:read', 'mcp:write'] as const;
  type AllowedScope = (typeof ALLOWED_KEY_SCOPES)[number];

  function normaliseScopes(input: unknown): AllowedScope[] | { error: string } {
    if (input === undefined || input === null) return ['report:write'];
    if (!Array.isArray(input) || input.length === 0) {
      return { error: 'scopes must be a non-empty array' };
    }
    const unique = Array.from(new Set(input.map(String)));
    const invalid = unique.filter((s) => !(ALLOWED_KEY_SCOPES as readonly string[]).includes(s));
    if (invalid.length > 0) {
      return {
        error: `Unknown scope(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_KEY_SCOPES.join(', ')}`,
      };
    }
    return unique as AllowedScope[];
  }

  // ============================================================
  // POST /v1/admin/auth/register
  //
  // OAuth 2.0 RFC 7591 Dynamic Client Registration.
  //
  // Allows orchestrators (LangGraph, OpenAI Agents, CrewAI, etc.) to
  // self-onboard by presenting an "initial access token" (any existing
  // project API key with `mcp:write` scope) and receiving a new
  // `client_id` / `client_secret` pair scoped for the operation the
  // orchestrator needs. The returned `client_secret` is the raw Mushi
  // API key; store it securely.
  //
  // Request body (RFC 7591 §3.1 metadata):
  //   {
  //     client_name: "my-langraph-agent",   // human-readable
  //     grant_types: ["client_credentials"], // must be client_credentials
  //     scope: "mcp:read mcp:write",         // space-separated Mushi scopes
  //     contacts: ["ops@example.com"]        // optional
  //   }
  //
  // Response (RFC 7591 §3.2):
  //   {
  //     client_id:                   "<uuid>",
  //     client_secret:               "mushi_...",
  //     client_secret_expires_at:    0,          // 0 = never expires
  //     client_id_issued_at:         <unix-secs>,
  //     client_name:                 "...",
  //     grant_types:                 ["client_credentials"],
  //     token_endpoint_auth_method:  "client_secret_post",
  //     scope:                       "mcp:read mcp:write"
  //   }
  // ============================================================
  app.post('/v1/admin/auth/register', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const apiKeyProjectId = c.get('projectId') as string | undefined;
    const db = getServiceClient();

    // Resolve the project: orchestrators using an API key get the key's
    // project; JWT users must pass projectId in the body.
    let resolvedProjectId: string | undefined = apiKeyProjectId
    const body = (await c.req.json().catch(() => ({}))) as {
      client_name?: unknown;
      grant_types?: unknown;
      scope?: unknown;
      contacts?: unknown;
      projectId?: unknown;
    };

    if (!resolvedProjectId) {
      if (typeof body.projectId !== 'string') {
        return c.json({
          error: 'invalid_client_metadata',
          error_description: 'projectId is required for JWT-authenticated registrations.',
        }, 400);
      }
      const access = await userCanAccessProject(db, userId, body.projectId as string);
      if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
        return c.json({ error: 'access_denied', error_description: 'Owner or admin required.' }, 403);
      }
      resolvedProjectId = body.projectId as string;
    }

    // Validate grant_types
    const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['client_credentials'];
    if (!grantTypes.every((g) => g === 'client_credentials')) {
      return c.json({
        error: 'invalid_client_metadata',
        error_description: 'Only grant_types=["client_credentials"] is supported.',
      }, 400);
    }

    // Parse requested scopes (space-separated, RFC 7591 §2)
    const scopeStr = typeof body.scope === 'string' ? body.scope : 'mcp:read';
    const requestedScopes = scopeStr.split(/\s+/).filter(Boolean);
    const scopes = normaliseScopes(requestedScopes);
    if ('error' in scopes) {
      return c.json({
        error: 'invalid_client_metadata',
        error_description: scopes.error,
      }, 400);
    }

    // client_name validation
    const clientName =
      typeof body.client_name === 'string' && body.client_name.trim().length > 0
        ? body.client_name.trim().slice(0, 64)
        : 'orchestrator';

    // Mint a new API key (same pattern as /v1/admin/projects/:id/keys).
    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const clientId = crypto.randomUUID();

    const { error: insertErr } = await db.from('project_api_keys').insert({
      id: clientId,
      project_id: resolvedProjectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label: `dcr:${clientName}`,
      scopes,
      is_active: true,
    });
    if (insertErr) {
      return c.json({ error: 'server_error', error_description: insertErr.message }, 500);
    }

    // Audit trail for DCR is critical: this is the only path where an
    // existing API key can mint another API key. If the initial-access
    // token leaks, owners need to see every minted client to revoke.
    // Failure here must not block the registration response — the key is
    // already persisted and the operator needs the secret returned.
    void logAudit(
      db,
      resolvedProjectId,
      userId ?? '00000000-0000-0000-0000-000000000000',
      'api_key.created',
      'project_api_key',
      clientId,
      {
        source: 'oauth_dcr',
        client_name: clientName,
        scopes,
        key_prefix: prefix,
      },
      {
        actorType: apiKeyProjectId ? 'api_key' : 'user',
        ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined,
        userAgent: c.req.header('user-agent') ?? undefined,
      },
    );

    const issuedAt = Math.floor(Date.now() / 1000);
    // RFC 7591 §3.2 response
    return c.json({
      client_id: clientId,
      client_secret: rawKey,
      client_secret_expires_at: 0,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: scopes.join(' '),
      // Non-standard: Mushi-specific fields for convenience.
      mushi_project_id: resolvedProjectId,
      mushi_key_prefix: prefix,
    }, 201);
  });

  app.post('/v1/admin/projects/:id/keys', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const body = (await c.req.json().catch(() => ({}))) as { scopes?: unknown; label?: string };
    const scopes = normaliseScopes(body.scopes);
    if ('error' in scopes) {
      return c.json({ ok: false, error: { code: 'INVALID_SCOPES', message: scopes.error } }, 400);
    }

    // Minting API keys is owner/admin-only (Teams v1: org owner/admin or
    // legacy direct project owner; viewers and members can't issue tokens).
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const label =
      typeof body.label === 'string' && body.label.trim().length > 0
        ? body.label.trim().slice(0, 64)
        : scopes.includes('mcp:write')
          ? 'mcp-readwrite'
          : scopes.includes('mcp:read')
            ? 'mcp-readonly'
            : 'default';

    const { error } = await db.from('project_api_keys').insert({
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label,
      scopes,
      is_active: true,
    });

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { key: rawKey, prefix, scopes, label } }, 201);
  });

  // Rotation endpoint advertised by the auth manifest.: previously a
  // 404 because no Hono route existed despite being listed under
  // `mushi-api-key.rotation_endpoint`. Atomic-ish rotate-then-issue:
  //
  //   1. Mark every active key on the project as revoked (soft-delete, audit
  //      log keeps the prefix for forensics).
  //   2. Mint a fresh key with the same crypto pattern as POST /keys.
  //   3. Return only the new key once — same one-shot semantics as initial
  //      generation so callers know to copy immediately.
  //
  // "Atomic-ish" because Supabase Edge Functions don't expose transactions; in
  // the worst case (network blip between the revoke and the insert) the project
  // is keyless until the second call retries. That is strictly safer than the
  // inverse — leaking a window where both the old and new keys are valid would
  // silently extend the rotated key's effective lifetime.
  app.post('/v1/admin/projects/:id/keys/rotate', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    // Set explicitly (rather than relying on withIdempotency's body-based
    // extraction) because this route takes projectId from the URL path,
    // not the request body — the cache-store step needs a project_id to
    // persist the response, or a dropped-connection retry would mint a
    // second key and immediately revoke the first (which the client never
    // saw), locking it out.
    c.set('projectId', projectId);
    return withIdempotency(c, async () => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Rotating an API key is owner/admin-only.
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single();
    if (!project) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const { data: existing, error: fetchError } = await db
      .from('project_api_keys')
      .select('id, key_prefix')
      .eq('project_id', projectId)
      .eq('is_active', true);
    if (fetchError) return dbError(c, fetchError);

    const revokedAt = new Date().toISOString();
    if (existing && existing.length > 0) {
      const { error: revokeError } = await db
        .from('project_api_keys')
        .update({ is_active: false, revoked_at: revokedAt })
        .eq('project_id', projectId)
        .eq('is_active', true);
      if (revokeError) return dbError(c, revokeError);
    }

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const { data: newRow, error: insertError } = await db
      .from('project_api_keys')
      .insert({
        project_id: projectId,
        key_hash: keyHash,
        key_prefix: prefix,
        label: 'rotated',
        is_active: true,
      })
      .select('id')
      .single();
    if (insertError) return dbError(c, insertError);

    const userEmail = c.get('userEmail') as string | undefined;
    await logAudit(
      db,
      projectId,
      userId,
      'api_key.created',
      'api_key',
      newRow?.id,
      {
        rotated: true,
        revoked_count: existing?.length ?? 0,
        revoked_prefixes: (existing ?? []).map((row: { key_prefix: string }) => row.key_prefix),
      },
      { email: userEmail },
    );

    return c.json(
      {
        ok: true,
        data: {
          key: rawKey,
          prefix,
          revoked: existing?.length ?? 0,
          rotated_at: revokedAt,
        },
      },
      201,
    );
    }); // withIdempotency
  });

  app.delete('/v1/admin/projects/:id/keys/:keyId', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const keyId = c.req.param('keyId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Revoking an API key is owner/admin-only.
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

    await db
      .from('project_api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', keyId)
      .eq('project_id', projectId);

    return c.json({ ok: true });
  });

}
