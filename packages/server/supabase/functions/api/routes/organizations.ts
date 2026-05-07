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
      .select(
        'role, organizations!inner(id, slug, name, plan_id, billing_mode, is_personal, created_at)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) return dbError(c, error);
    const orgs = (data ?? []).map((row) => ({
      ...(row.organizations as unknown as Record<string, unknown>),
      role: row.role,
    }));
    return c.json({ ok: true, data: { organizations: orgs } });
  });

  // Create a brand-new organization (team) with the caller as owner.
  // Used by the OrgSwitcher "+ New team" affordance in the global header.
  // Personal orgs are created by the auth-trigger backfill, so anything
  // built via this route is explicitly a non-personal team workspace.
  app.post('/v1/org', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      slug?: unknown;
    };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 120) {
      return c.json(
        { ok: false, error: { code: 'BAD_NAME', message: 'Name must be 1-120 characters.' } },
        400,
      );
    }

    // Slug rules mirror the CHECK constraint on `organizations.slug`:
    //   ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$ — 3-64 chars, no leading/trailing dash.
    // Build a candidate from `slug` if supplied, else slugify the name.
    const rawSlug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const slugSource = rawSlug || name;
    const baseSlug = slugSource
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'team';

    const db = getServiceClient();

    // Slug uniqueness: probe up to 10 numeric suffixes before falling back
    // to a random one. The CHECK constraint forbids leading/trailing dashes
    // and requires 3+ chars, so we pad short bases.
    async function findFreeSlug(): Promise<string | null> {
      const padded = baseSlug.length < 3 ? `${baseSlug}-team` : baseSlug;
      const candidates = [padded, ...Array.from({ length: 10 }, (_, i) => `${padded}-${i + 2}`)];
      for (const candidate of candidates) {
        const slugged = candidate.replace(/^-+|-+$/g, '').slice(0, 64);
        if (slugged.length < 3) continue;
        const { data: clash } = await db
          .from('organizations')
          .select('id')
          .eq('slug', slugged)
          .maybeSingle();
        if (!clash) return slugged;
      }
      // Fall back to a hash-style suffix to guarantee uniqueness even if
      // the deterministic candidates all collide (extremely unlikely).
      const random = Math.random().toString(36).slice(2, 8);
      return `${baseSlug.slice(0, 50)}-${random}`.replace(/^-+|-+$/g, '').slice(0, 64);
    }

    const slug = await findFreeSlug();
    if (!slug) {
      return c.json({ ok: false, error: { code: 'SLUG_GENERATION_FAILED' } }, 500);
    }

    const { data: org, error: insertErr } = await db
      .from('organizations')
      .insert({
        name,
        slug,
        owner_id: userId,
        is_personal: false,
      })
      .select('id, slug, name, plan_id, billing_mode, is_personal, created_at')
      .single();

    if (insertErr || !org) {
      return dbError(c, insertErr ?? { message: 'organization_insert_failed' });
    }

    // Membership: caller is the founding owner. The org gets no project
    // implicitly — the FE prompts the user to create one inside the new
    // workspace, mirroring how Vercel/Linear onboard a fresh team.
    const { error: memberErr } = await db
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: userId,
        role: 'owner',
      });
    if (memberErr) {
      // Roll back the org so the user isn't stranded with an org they
      // can't see (RLS only surfaces orgs they're a member of).
      await db.from('organizations').delete().eq('id', org.id);
      return dbError(c, memberErr);
    }

    return c.json({
      ok: true,
      data: { organization: { ...org, role: 'owner' } },
    });
  });

  // Rename an organization (team). Owner and admin can change the display
  // name; slug is intentionally NOT mutable here because it's embedded in
  // shared URLs and Stripe customer metadata — a cosmetic rename should
  // never invalidate links coworkers have already bookmarked. If we ever
  // need slug edits, make them a separate, explicit "Change handle" flow
  // gated on `owner` and aware of the URL implications.
  app.patch('/v1/org/:id', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    if (!UUID_RE.test(orgId)) {
      return c.json({ ok: false, error: { code: 'BAD_ORG' } }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    if (rawName.length < 1 || rawName.length > 120) {
      return c.json(
        { ok: false, error: { code: 'BAD_NAME', message: 'Name must be 1-120 characters.' } },
        400,
      );
    }

    const db = getServiceClient();
    const role = await loadMembership(db, orgId, actorId);
    if (!role) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    if (role !== 'owner' && role !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

    const { data: updated, error } = await db
      .from('organizations')
      .update({ name: rawName, updated_at: new Date().toISOString() })
      .eq('id', orgId)
      .select('id, slug, name, plan_id, billing_mode, is_personal, created_at')
      .single();
    if (error || !updated) return dbError(c, error ?? { message: 'organization_update_failed' });

    // Best-effort audit trail. Anchored to the org's first project (matches
    // how membership/invite changes are logged) so the org rename is
    // discoverable from any project's audit feed inside the org.
    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization', orgId, {
        organizationId: orgId,
        name: rawName,
      }).catch(() => {});
    }

    return c.json({ ok: true, data: { organization: { ...updated, role } } });
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
