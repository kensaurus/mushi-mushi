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

// Resolve a "human-friendly" name for an inviter. Supabase doesn't model
// display names natively, so the canonical sources in priority order are:
//   1. raw_user_meta_data.full_name (set by social logins like Google/GitHub)
//   2. raw_user_meta_data.name (some providers use this key instead)
//   3. raw_user_meta_data.display_name (older / custom flows)
//   4. the email's local-part as a last-resort title-cased label
// The fallback keeps the invite email and preview screen looking
// intentional even for invitees who joined with a magic link and never
// filled in a profile.
async function userDisplayInfoById(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const user = data.user;
    if (!user) return { email: null, name: null };
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const pick = (key: string): string | null => {
      const v = meta[key];
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    let name = pick('full_name') ?? pick('name') ?? pick('display_name');
    if (!name && user.email) {
      const local = user.email.split('@')[0] ?? '';
      // Title-case the local-part so "alice.dev" → "Alice Dev". Cosmetic
      // only — the email itself is shown alongside, so a perfect humanise
      // isn't required, just better than the literal email twice.
      name = local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ') || null;
    }
    return { email: user.email ?? null, name };
  } catch {
    return { email: null, name: null };
  }
}

// Atomic per-actor rate limit using the existing scoped_rate_limit_claim
// RPC. Returns null on success, or a 429-shaped JSON error on miss so the
// caller can `return c.json(err.body, err.status)` directly. We bury the
// throw/catch here because the RPC raises a Postgres error with a magic
// `rate_limit_exceeded` token — every call site shouldn't have to know
// that wire format.
async function claimRateLimit(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  scope: string,
  maxPerWindow: number,
  windowInterval: string,
): Promise<{ status: number; body: { ok: false; error: { code: string; message: string } } } | null> {
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: userId,
    p_scope: scope,
    p_max_per_window: maxPerWindow,
    p_window: windowInterval,
  });
  if (!error) return null;
  if ((error.message ?? '').includes('rate_limit_exceeded')) {
    return {
      status: 429,
      body: {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Limit reached: ${maxPerWindow} per ${windowInterval}. Try again later.`,
        },
      },
    };
  }
  // Unknown RPC failure — surface as a generic 500 so we don't silently
  // bypass the rate limit when the table is unavailable.
  return {
    status: 500,
    body: { ok: false, error: { code: 'RATE_LIMIT_BACKEND', message: error.message } },
  };
}

// Seat-cap pre-check. Counts active members + still-pending invites
// against `pricing_plans.seat_limit`. Returns null when there's room (or
// when the plan has no cap, NULL = unlimited), or a 402-shaped error so
// the route can short-circuit. Done as a single round-trip with two
// counts so a high-volume invite-storming admin doesn't get N queries.
async function checkSeatCap(
  db: ReturnType<typeof getServiceClient>,
  orgId: string,
): Promise<{ status: number; body: { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } } } | null> {
  const { data: org } = await db
    .from('organizations')
    .select('plan_id')
    .eq('id', orgId)
    .maybeSingle();
  if (!org?.plan_id) return null;

  const { data: plan } = await db
    .from('pricing_plans')
    .select('seat_limit, display_name')
    .eq('id', org.plan_id)
    .maybeSingle();
  if (!plan?.seat_limit) return null; // NULL = unlimited

  const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
    db.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId),
    db
      .from('invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
  ]);

  const used = (memberCount ?? 0) + (pendingCount ?? 0);
  if (used < plan.seat_limit) return null;

  return {
    status: 402,
    body: {
      ok: false,
      error: {
        code: 'SEAT_CAP_REACHED',
        message: `${plan.display_name ?? plan.seat_limit} plan is at its ${plan.seat_limit}-seat cap. Upgrade or remove a member to invite more.`,
        details: { used, cap: plan.seat_limit, members: memberCount ?? 0, pending: pendingCount ?? 0 },
      },
    },
  };
}

// Sanitise an inviter's personal note. Plain-text only — strip control
// characters, collapse whitespace, hard-cap at 280 chars (matches the
// CHECK constraint on invitations.note). Returns null for empty input
// so the caller can pass it straight through to the INSERT.
function sanitiseNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return null;
  return cleaned.length > 280 ? cleaned.slice(0, 280) : cleaned;
}

async function rosterWithEmails(
  db: ReturnType<typeof getServiceClient>,
  rows: Array<{
    user_id: string;
    role: OrgRole;
    invited_by: string | null;
    created_at: string;
    last_active_at: string | null;
    joined_via: string | null;
  }>,
) {
  return Promise.all(
    rows.map(async (row) => ({
      user_id: row.user_id,
      email: await userEmailById(db, row.user_id),
      role: row.role,
      invited_by: row.invited_by,
      created_at: row.created_at,
      // Activity & provenance fields drive the "Active 3d ago" and
      // "Founder" / "Invited" labels in the roster UI. Both can legitimately
      // be null on legacy rows — the FE handles that as "Never active" /
      // "Direct".
      last_active_at: row.last_active_at,
      joined_via: row.joined_via,
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

export function registerOrganizationRoutes(app: Hono<{ Variables: Variables }>): void {
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

    // Slug allocation is race-safe: we generate a list of candidates
    // (deterministic + random tail) and INSERT each one in turn,
    // catching Postgres unique-violation (code 23505) and trying the
    // next candidate. The previous "probe then insert" version had a
    // TOCTOU race where two concurrent /v1/org calls would both see
    // the same slug as free, then one would succeed and the other
    // would surface a 500 via dbError — bad UX during onboarding.
    //
    // The CHECK constraint on organizations.slug forbids
    // leading/trailing dashes and requires 3+ chars, so we pad short
    // bases. Random tail uses crypto.getRandomValues so concurrent
    // racers don't both land on the same Math.random() seed when the
    // event loop is busy.
    const padded = baseSlug.length < 3 ? `${baseSlug}-team` : baseSlug;
    function randSuffix(): string {
      const buf = new Uint8Array(4);
      crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    const candidates = [
      padded,
      ...Array.from({ length: 10 }, (_, i) => `${padded}-${i + 2}`),
      ...Array.from({ length: 5 }, () => `${padded.slice(0, 50)}-${randSuffix()}`),
    ]
      .map((s) => s.replace(/^-+|-+$/g, '').slice(0, 64))
      .filter((s) => s.length >= 3);

    type OrgInsertRow = {
      id: string;
      slug: string;
      name: string;
      plan_id: string | null;
      billing_mode: string | null;
      is_personal: boolean;
      created_at: string;
    };
    let org: OrgInsertRow | null = null;
    let lastInsertErr: unknown = null;
    for (const slug of candidates) {
      const { data, error } = await db
        .from('organizations')
        .insert({
          name,
          slug,
          owner_id: userId,
          is_personal: false,
        })
        .select('id, slug, name, plan_id, billing_mode, is_personal, created_at')
        .single();
      if (data) {
        org = data as OrgInsertRow;
        break;
      }
      lastInsertErr = error;
      // Postgres unique-violation = SQLSTATE 23505. supabase-js surfaces
      // this on `error.code`; some adapters surface it on `.details`/
      // `.message` so we belt-and-suspender match. Anything else is a
      // hard error and we stop retrying.
      const code = (error as { code?: string } | null)?.code ?? '';
      const msg = (error as { message?: string } | null)?.message ?? '';
      const isUniqueViolation =
        code === '23505' || /duplicate key|unique constraint/i.test(msg);
      if (!isUniqueViolation) break;
    }
    if (!org) {
      return dbError(c, (lastInsertErr as { message?: string } | null) ?? {
        message: 'organization_insert_failed_no_free_slug',
      });
    }

    // Membership: caller is the founding owner. The org gets no project
    // implicitly — the FE prompts the user to create one inside the new
    // workspace, mirroring how Vercel/Linear onboard a fresh team.
    //
    // joined_via='founding_owner' explicitly tags the founding row so
    // the roster UI can render a "Founder" badge and the audit log can
    // distinguish "this user created the org" from "this user accepted
    // an invite". last_active_at is stamped now() because creating the
    // org is itself meaningful activity — without it, the founder would
    // appear "Never active" in the new roster until their next request.
    const { error: memberErr } = await db
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: userId,
        role: 'owner',
        joined_via: 'founding_owner',
        last_active_at: new Date().toISOString(),
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
        // last_active_at + joined_via feed the new "Active 3d ago" column
        // and the "Founder / Invited / Direct" provenance pill in the
        // roster. Sort by activity (most-recent first, NULLs last) so the
        // most-engaged members surface above coasting seats — the FE can
        // re-sort to suit, but this is the right default for the question
        // an admin most often asks of this page ("who's actually using
        // their seat?").
        .select('user_id, role, invited_by, created_at, last_active_at, joined_via')
        .eq('organization_id', orgId)
        .order('last_active_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: true }),
      db
        // The token is sensitive but only goes to org owner/admins (this
        // route already gates on `loadMembership`), and they need it to
        // surface "Copy invite link" as a deliverability fallback when
        // the auth email lands in the invitee's spam folder. Same trust
        // boundary as the email + role columns we already return.
        .from('invitations')
        .select('id, email, role, token, invited_by, expires_at, accepted_at, revoked_at, last_resent_at, resend_count, last_seen_at, note, created_at')
        .eq('organization_id', orgId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ]);
    if (error) return dbError(c, error);
    // Owner/admin gate enforced above; viewers and members never see this
    // route. Restrict the token field to the manage-capable roles as a
    // belt-and-braces guard so a future RLS regression can't accidentally
    // leak tokens to read-only roles.
    if (role !== 'owner' && role !== 'admin') {
      for (const i of (invitations ?? []) as Array<{ token?: string | null }>) {
        i.token = null;
      }
    }

    // Resolve the inviter's email for each pending invitation so the
    // Members UI can render "Invited 3h ago by alice@example.com"
    // without a second round-trip. We dedupe by user id first because
    // a busy admin frequently sends 5+ invites in a row and we don't
    // want N admin.getUserById calls when 1 would do.
    const inviterIds = Array.from(
      new Set(((invitations ?? []) as Array<{ invited_by: string | null }>).map((i) => i.invited_by).filter((id): id is string => Boolean(id))),
    );
    const inviterEmailById = new Map<string, string | null>();
    await Promise.all(
      inviterIds.map(async (id) => {
        inviterEmailById.set(id, await userEmailById(db, id));
      }),
    );
    const decoratedInvitations = ((invitations ?? []) as Array<{
      id: string;
      email: string;
      role: InviteRole;
      token: string | null;
      invited_by: string | null;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      last_resent_at: string | null;
      resend_count: number;
      last_seen_at: string | null;
      note: string | null;
      created_at: string;
    }>).map((i) => ({
      ...i,
      invited_by_email: i.invited_by ? inviterEmailById.get(i.invited_by) ?? null : null,
    }));

    return c.json({
      ok: true,
      data: {
        organization: org,
        currentUserRole: role,
        members: await rosterWithEmails(
          db,
          (members ?? []) as Array<{
            user_id: string;
            role: OrgRole;
            invited_by: string | null;
            created_at: string;
            last_active_at: string | null;
            joined_via: string | null;
          }>,
        ),
        invitations: decoratedInvitations,
      },
    });
  });

  app.get('/v1/org/:id/members/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const orgId = c.req.param('id');
    if (!UUID_RE.test(orgId)) return c.json({ ok: false, error: { code: 'BAD_ORG' } }, 400);
    const db = getServiceClient();
    const role = await loadMembership(db, orgId, userId);
    if (!role) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const inactiveSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeSince7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiringBefore = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const [{ data: org }, { data: memberRows, error: memberErr }, { data: inviteRows, error: inviteErr }] =
      await Promise.all([
        db.from('organizations').select('id, slug, name, plan_id').eq('id', orgId).maybeSingle(),
        db
          .from('organization_members')
          .select('last_active_at')
          .eq('organization_id', orgId),
        db
          .from('invitations')
          .select('id, expires_at')
          .eq('organization_id', orgId)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .gt('expires_at', nowIso),
      ]);

    if (memberErr) return dbError(c, memberErr);
    if (inviteErr) return dbError(c, inviteErr);

    const members = memberRows ?? [];
    const invites = inviteRows ?? [];
    const memberCount = members.length;
    const pendingInvites = invites.length;

    let seatLimit: number | null = null;
    let planDisplayName: string | null = null;
    if (org?.plan_id) {
      const { data: plan } = await db
        .from('pricing_plans')
        .select('seat_limit, display_name')
        .eq('id', org.plan_id)
        .maybeSingle();
      seatLimit = (plan as { seat_limit?: number | null } | null)?.seat_limit ?? null;
      planDisplayName = (plan as { display_name?: string | null } | null)?.display_name ?? null;
    }

    const seatsUsed = memberCount + pendingInvites;
    const seatsRemaining = seatLimit === null ? null : Math.max(0, seatLimit - seatsUsed);
    const atSeatCap = seatLimit !== null && seatsUsed >= seatLimit;

    let inactiveCount = 0;
    let activeLast7d = 0;
    for (const m of members) {
      const last = (m as { last_active_at?: string | null }).last_active_at ?? null;
      if (!last || last < inactiveSince) inactiveCount += 1;
      if (last && last >= activeSince7d) activeLast7d += 1;
    }

    const expiringSoonInvites = invites.filter(
      (i) => (i as { expires_at: string }).expires_at <= expiringBefore,
    ).length;

    const canManage = role === 'owner' || role === 'admin';

    return c.json({
      ok: true,
      data: {
        memberCount,
        pendingInvites,
        seatLimit,
        seatsUsed,
        seatsRemaining,
        inactiveCount,
        activeLast7d,
        expiringSoonInvites,
        atSeatCap,
        planId: (org as { plan_id?: string | null } | null)?.plan_id ?? null,
        planDisplayName,
        currentUserRole: role,
        canManage,
        organizationName: (org as { name?: string | null } | null)?.name ?? null,
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
    const note = sanitiseNote(body.note);
    if (!UUID_RE.test(orgId) || !email) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Valid email required' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

    // Per-inviter rate limit BEFORE the seat-cap check, so a single bad
    // actor can't burn the project's Supabase SMTP quota with rapid 402s.
    // 20/hour comfortably covers a power admin onboarding a new team in
    // one sitting; anything beyond that should batch via a CSV importer.
    const rateMiss = await claimRateLimit(db, actorId, 'invite_send', 20, '1 hour');
    if (rateMiss) return c.json(rateMiss.body, rateMiss.status as 429 | 500);

    // Seat-cap pre-check. Reject before we INSERT/email so the operator
    // sees a clean "you're at the cap" message instead of an opaque
    // foreign-key or trigger violation deeper in the stack.
    const seatMiss = await checkSeatCap(db, orgId);
    if (seatMiss) return c.json(seatMiss.body, seatMiss.status as 402);

    const { data: invite, error } = await db
      .from('invitations')
      .insert({ organization_id: orgId, email, role, invited_by: actorId, note })
      .select('id, email, role, token, expires_at, created_at, note')
      .single();
    if (error || !invite) {
      return c.json({ ok: false, error: { code: 'INVITE_FAILED', message: error?.message ?? 'Invite failed' } }, 400);
    }

    const acceptPath = `/invite/accept?token=${encodeURIComponent(invite.token)}`;
    // Resolve org name + inviter info so the auth email template can
    // render "Alice invited you to join Acme" via {{ .Data.org_name }} /
    // {{ .Data.inviter_name }}. We do this BEFORE the auth call so a
    // failure here doesn't strand a half-sent invite (the catch on the
    // auth call below intentionally swallows transport errors so the
    // invitation row still ships — operators can Resend if needed).
    const [{ data: org }, inviter] = await Promise.all([
      db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      userDisplayInfoById(db, actorId),
    ]);
    await db.auth.admin
      .inviteUserByEmail(email, {
        redirectTo: adminUrl(acceptPath),
        data: {
          org_name: org?.name ?? 'your team',
          org_id: orgId,
          inviter_name: inviter.name,
          inviter_email: inviter.email,
          role,
          note,
          accept_url: adminUrl(acceptPath),
        },
      })
      .catch(() => null);

    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization_invitation', invite.id, {
        organizationId: orgId,
        email,
        role,
        hasNote: Boolean(note),
      }).catch(() => {});
    }
    return c.json({ ok: true, data: { invitation: invite, acceptUrl: adminUrl(acceptPath) } }, 201);
  });

  app.delete('/v1/org/:id/invitations/:invitationId', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const invitationId = c.req.param('invitationId');
    if (!UUID_RE.test(orgId) || !UUID_RE.test(invitationId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    // Idempotent guard: pull the row first so a double-click on the
    // Cancel button (or a retry of an already-revoked invite) returns
    // the same shape instead of stamping `revoked_by` twice or
    // overwriting the original revoker's audit record.
    const { data: existing } = await db
      .from('invitations')
      .select('id, email, role, accepted_at, revoked_at')
      .eq('organization_id', orgId)
      .eq('id', invitationId)
      .maybeSingle();
    if (!existing) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    }
    if (existing.accepted_at) {
      // Once accepted, the invite has already minted a membership row.
      // Cancelling it here would silently "lose" that audit trail; the
      // operator wants `DELETE /members/:userId` instead.
      return c.json({
        ok: false,
        error: {
          code: 'ALREADY_ACCEPTED',
          message: 'This invitation was already accepted. Remove the member instead.',
        },
      }, 409);
    }
    if (existing.revoked_at) {
      // No-op success — the invite is already cancelled. UI sometimes
      // re-fires this on optimistic-update reconciliation; returning ok
      // keeps the member list in sync without a fake error toast.
      return c.json({ ok: true, data: { alreadyRevoked: true } });
    }

    const nowIso = new Date().toISOString();
    const { error } = await db
      .from('invitations')
      .update({ revoked_at: nowIso, revoked_by: actorId })
      .eq('organization_id', orgId)
      .eq('id', invitationId);
    if (error) return dbError(c, error);

    // Audit the revocation against the org's first project so it shows
    // up in the same audit feed as the corresponding invite send. Best
    // effort — failing audit must not strand a successful revocation.
    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization_invitation', invitationId, {
        organizationId: orgId,
        action: 'revoked',
        email: existing.email,
        role: existing.role,
      }).catch(() => {});
    }
    return c.json({ ok: true });
  });

  // Resend an existing invitation. Re-issues the Supabase auth email
  // (so the recipient gets a fresh "click here to join" message even if
  // the original was lost to spam filters) and bumps `last_resent_at` +
  // `resend_count` for the operator audit trail. The token itself is
  // unchanged — accepting via the original email still works as long as
  // the invite hasn't expired.
  app.post('/v1/org/:id/invitations/:invitationId/resend', jwtAuth, async (c) => {
    const actorId = c.get('userId') as string;
    const orgId = c.req.param('id');
    const invitationId = c.req.param('invitationId');
    if (!UUID_RE.test(orgId) || !UUID_RE.test(invitationId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST' } }, 400);
    }
    const db = getServiceClient();
    const actorRole = await loadMembership(db, orgId, actorId);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }

    // Per-invite cooldown: cap at 3 resends per 24h on a single invite
    // so a frustrated admin can't spam the same recipient hourly. Caps
    // at 30 resends/hour across all invites per actor for the same
    // reason scaled up to a busy onboarding session. Both must pass.
    const perInvite = await claimRateLimit(db, actorId, `invite_resend:${invitationId}`, 3, '24 hours');
    if (perInvite) return c.json(perInvite.body, perInvite.status as 429 | 500);
    const perActor = await claimRateLimit(db, actorId, 'invite_resend', 30, '1 hour');
    if (perActor) return c.json(perActor.body, perActor.status as 429 | 500);

    const { data: existing } = await db
      .from('invitations')
      .select('id, email, role, token, expires_at, accepted_at, revoked_at, resend_count, note')
      .eq('organization_id', orgId)
      .eq('id', invitationId)
      .maybeSingle();
    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    if (existing.accepted_at) {
      return c.json({
        ok: false,
        error: { code: 'ALREADY_ACCEPTED', message: 'This invitation was already accepted.' },
      }, 409);
    }
    if (existing.revoked_at) {
      return c.json({
        ok: false,
        error: { code: 'ALREADY_REVOKED', message: 'This invitation was cancelled. Send a new invite instead.' },
      }, 409);
    }
    if (new Date(existing.expires_at).getTime() <= Date.now()) {
      return c.json({
        ok: false,
        error: { code: 'EXPIRED', message: 'This invitation has expired. Send a new invite to refresh the 7-day window.' },
      }, 409);
    }

    const acceptPath = `/invite/accept?token=${encodeURIComponent(existing.token)}`;
    const [{ data: org }, inviter] = await Promise.all([
      db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      userDisplayInfoById(db, actorId),
    ]);
    await db.auth.admin
      .inviteUserByEmail(existing.email, {
        redirectTo: adminUrl(acceptPath),
        data: {
          org_name: org?.name ?? 'your team',
          org_id: orgId,
          inviter_name: inviter.name,
          inviter_email: inviter.email,
          role: existing.role,
          note: existing.note ?? null,
          accept_url: adminUrl(acceptPath),
          resend: true,
        },
      })
      .catch(() => null);

    const nowIso = new Date().toISOString();
    const { error: updErr } = await db
      .from('invitations')
      .update({
        last_resent_at: nowIso,
        resend_count: (existing.resend_count ?? 0) + 1,
      })
      .eq('organization_id', orgId)
      .eq('id', invitationId);
    if (updErr) return dbError(c, updErr);

    const projectId = await firstProjectId(db, orgId);
    if (projectId) {
      await logAudit(db, projectId, actorId, 'settings.updated', 'organization_invitation', invitationId, {
        organizationId: orgId,
        action: 'resent',
        email: existing.email,
        role: existing.role,
        resendCount: (existing.resend_count ?? 0) + 1,
      }).catch(() => {});
    }

    return c.json({
      ok: true,
      data: {
        invitationId,
        lastResentAt: nowIso,
        resendCount: (existing.resend_count ?? 0) + 1,
      },
    });
  });

  // Preview-before-accept. Resolves a token (the bearer secret in the
  // emailed link) into the public-ish facts the invitee needs to make
  // an informed Accept decision: which org, what role, who invited
  // them, when the link expires, what the optional personal note says.
  // Critically returns a `status` discriminator so the FE can render
  // the right branch (expired / revoked / accepted-already / wrong-
  // signed-in-account) without parsing error strings. No JWT required —
  // the token IS the auth, exactly as the original auth email asserted.
  // Stamps `last_seen_at` on the first preview call so operators can
  // tell "ignored / spam-filtered" from "opened but did not accept".
  app.get('/v1/invitations/preview', async (c) => {
    const token = c.req.query('token')?.trim() ?? '';
    if (!token || token.length < 16 || token.length > 200) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'token required' } }, 400);
    }
    const db = getServiceClient();
    const { data: invite } = await db
      .from('invitations')
      .select('id, organization_id, email, role, invited_by, expires_at, accepted_at, revoked_at, last_seen_at, note, created_at')
      .eq('token', token)
      .maybeSingle();
    if (!invite) {
      // Don't leak whether the token ever existed — uniform 404 for
      // garbage and for revoked tokens whose row has been hard-deleted.
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }, 404);
    }

    let status: 'pending' | 'accepted' | 'revoked' | 'expired' = 'pending';
    if (invite.accepted_at) status = 'accepted';
    else if (invite.revoked_at) status = 'revoked';
    else if (new Date(invite.expires_at).getTime() <= Date.now()) status = 'expired';

    const [{ data: org }, inviter] = await Promise.all([
      db.from('organizations').select('id, name, slug').eq('id', invite.organization_id).maybeSingle(),
      invite.invited_by
        ? userDisplayInfoById(db, invite.invited_by)
        : Promise.resolve({ email: null, name: null }),
    ]);

    // Stamp last_seen_at exactly once — first preview wins. Subsequent
    // previews don't overwrite so operators get a stable "first opened"
    // signal rather than a noisy "most recent" one. Best-effort: a
    // failure here doesn't block the response.
    if (status === 'pending' && !invite.last_seen_at) {
      await db
        .from('invitations')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', invite.id)
        .is('last_seen_at', null)
        .catch(() => {});
    }

    return c.json({
      ok: true,
      data: {
        status,
        invitation: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          note: invite.note,
          expires_at: invite.expires_at,
          created_at: invite.created_at,
        },
        organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
        inviter: { email: inviter.email, name: inviter.name },
      },
    });
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
      // Map the Postgres-level errors raised by accept_invitation() to
      // structured codes so the FE can show targeted UX (e.g. a clear
      // "you're signed in as the wrong account" branch on email
      // mismatch) instead of a generic toast on every failure path.
      const msg = error.message ?? '';
      let code = 'INVITE_ACCEPT_FAILED';
      if (msg.includes('invitation_invalid_or_expired')) code = 'EXPIRED_OR_REVOKED';
      else if (msg.includes('invitation_email_mismatch')) code = 'EMAIL_MISMATCH';
      else if (msg.includes('unauthenticated')) code = 'UNAUTHENTICATED';
      return c.json({ ok: false, error: { code, message: msg } }, 400);
    }
    return c.json({ ok: true, data: { organizationId: data } });
  });
}
