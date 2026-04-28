import type { Hono } from 'npm:hono@4';

import { getServiceClient, getUserClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { requireFeature } from '../../_shared/entitlements.ts';
import { logAudit } from '../../_shared/audit.ts';
import { dbError } from '../shared.ts';

const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
type OrgRole = (typeof ORG_ROLES)[number];
type InviteRole = (typeof INVITE_ROLES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && ORG_ROLES.includes(value as OrgRole);
}

function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && INVITE_ROLES.includes(value as InviteRole);
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function loadMembership(db: ReturnType<typeof getServiceClient>, orgId: string, userId: string) {
  const { data } = await db
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role as OrgRole | undefined;
}

async function firstProjectId(db: ReturnType<typeof getServiceClient>, orgId: string): Promise<string | null> {
  const { data } = await db
    .from('projects')
    .select('id')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function userEmailById(db: ReturnType<typeof getServiceClient>, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

async function rosterWithEmails(
  db: ReturnType<typeof getServiceClient>,
  rows: Array<{ user_id: string; role: OrgRole; invited_by: string | null; created_at: string }>,
) {
  return Promise.all(
    rows.map(async (row) => ({
      user_id: row.user_id,
      email: await userEmailById(db, row.user_id),
      role: row.role,
      invited_by: row.invited_by,
      created_at: row.created_at,
    })),
  );
}

function adminUrl(path: string): string {
  const base =
    Deno.env.get('MUSHI_ADMIN_URL') ??
    Deno.env.get('SITE_URL') ??
    'https://kensaur.us/mushi-mushi/admin';
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function registerOrganizationRoutes(app: Hono): void {
  app.get('/v1/org', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data, error } = await db
      .from('organization_members')
      .select('role, organizations!inner(id, slug, name, plan_id, is_personal, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) return dbError(c, error);
    const orgs = (data ?? []).map((row) => ({
      ...(row.organizations as unknown as Record<string, unknown>),
      role: row.role,
    }));
    return c.json({ ok: true, data: { organizations: orgs } });
  });

  app.get('/v1/org/:id/members', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const orgId = c.req.param('id');
    if (!UUID_RE.test(orgId)) return c.json({ ok: false, error: { code: 'BAD_ORG' } }, 400);
    const db = getServiceClient();
    const role = await loadMembership(db, orgId, userId);
    if (!role) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const [{ data: org }, { data: members, error }, { data: invitations }] = await Promise.all([
      db.from('organizations').select('id, slug, name, plan_id, is_personal').eq('id', orgId).maybeSingle(),
      db
        .from('organization_members')
        .select('user_id, role, invited_by, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true }),
      db
        .from('invitations')
        .select('id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at')
        .eq('organization_id', orgId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);
    if (error) return dbError(c, error);
    return c.json({
      ok: true,
      data: {
        organization: org,
        currentUserRole: role,
        members: await rosterWithEmails(db, (members ?? []) as Array<{ user_id: string; role: OrgRole; invited_by: string | null; created_at: string }>),
        invitations: invitations ?? [],
      },
    });
  });

  app.patch('/v1/org/:id/members/:userId', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const body = await c.req.json().catch(() => ({}));
    if (!UUID_RE.test(orgId) || !UUID_RE.test(targetUserId) || !isRole(body.role)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    if (body.role === 'owner' && actorRole !== 'owner') {
      return c.json({ ok: false, error: { code: 'OWNER_REQUIRED' } }, 403);
    }
    const { error } = await db
      .from('organization_members')
      .update({ role: body.role })
      .eq('organization_id', orgId)
      .eq('user_id', targetUserId);
    if (error) return dbError(c, error);
    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization_member', targetUserId, {
        organizationId: orgId,
        role: body.role,
      }).catch(() => {});
    }
    return c.json({ ok: true });
  });

  app.delete('/v1/org/:id/members/:userId', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    if (!UUID_RE.test(orgId) || !UUID_RE.test(targetUserId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (!actorRole) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    if (actorId !== targetUserId && actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const { error } = await db
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', targetUserId);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  app.post('/v1/org/:id/invitations', jwtAuth, requireFeature('teams'), async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const role = isInviteRole(body.role) ? body.role : 'member';
    if (!UUID_RE.test(orgId) || !email) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Valid email required' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

    const { data: invite, error } = await db
      .from('invitations')
      .insert({ organization_id: orgId, email, role, invited_by: actorId })
      .select('id, email, role, token, expires_at, created_at')
      .single();
    if (error || !invite) {
      return c.json({ ok: false, error: { code: 'INVITE_FAILED', message: error?.message ?? 'Invite failed' } }, 400);
    }

    const acceptPath = `/invite/accept?token=${encodeURIComponent(invite.token)}`;
    await db.auth.admin
      .inviteUserByEmail(email, { redirectTo: adminUrl(acceptPath) })
      .catch(() => null);

    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization_invitation', invite.id, {
        organizationId: orgId,
        email,
        role,
      }).catch(() => {});
    }
    return c.json({ ok: true, data: { invitation: invite, acceptUrl: adminUrl(acceptPath) } }, 201);
  });

  app.delete('/v1/org/:id/invitations/:invitationId', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const invitationId = c.req.param('invitationId');
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    const { error } = await db
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('id', invitationId);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  app.post('/v1/invitations/accept', jwtAuth, async (c) => {
    const authHeader = c.req.header('Authorization');
    const body = await c.req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token || !authHeader) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'token required' } }, 400);
    }
    const userDb = getUserClient(authHeader);
    const { data, error } = await userDb.rpc('accept_invitation', { p_token: token });
    if (error) {
      return c.json({ ok: false, error: { code: 'INVITE_ACCEPT_FAILED', message: error.message } }, 400);
    }
    return c.json({ ok: true, data: { organizationId: data } });
  });
}
