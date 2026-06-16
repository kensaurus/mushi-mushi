# Enterprise Tenancy Backlog

Follow-up items for production-grade multi-tenant SaaS. **Not in scope for the initial hardening PRs** — track here for prioritization.

## Auth policy (organization-owned)

- [ ] `organizations.sso_required` — block password login when SSO is mandated
- [ ] `organizations.mfa_required` — enforce MFA for all members
- [ ] `organizations.invite_only` — disable public join / domain discovery
- [ ] `organizations.allowed_email_domains[]` — restrict invites to verified domains

## Verified domain flow

- [ ] DNS TXT / CNAME verification for `organization_domains`
- [ ] Auto-suggest org join for users with matching email domain
- [ ] Admin UI for domain claim + conflict resolution

## Fine-grained RBAC

- [ ] Role templates beyond owner/admin/member/viewer
- [ ] Per-resource permissions (e.g. `reports:write`, `keys:rotate`)
- [ ] Enterprise override matrix on `organization_settings`

## Data residency

- [ ] `organizations.region` placement (not only per-project rows)
- [ ] Route storage + embeddings to region-specific buckets
- [ ] Cross-region read replicas for global admin console

## Tenant-aware caching

- [ ] Cache key standard: `{org_id}:{project_id}:{role}:{schema_version}:{route}`
- [ ] Invalidate on org switch, project switch, role change
- [ ] CDN edge cache must never key only on URL path

## Operational controls

- [ ] `organizations.suspended_at` — tenant kill switch for abuse / unpaid
- [ ] Per-tenant export runbook (GDPR / SOC2)
- [ ] Per-tenant delete runbook with retention receipts in `org_audit_events`

## JWT org claims (future optimization)

- [ ] Optional `active_org_id` + `org_role` in JWT app metadata
- [ ] Explicit token refresh on role change (avoid stale claims)
- [ ] Keep RLS + route checks as primary boundary — claims are hint only

## References

- Route scope matrix: [`docs/multi-tenancy-route-scope.md`](./multi-tenancy-route-scope.md)
- Teams v1 RLS baseline: `packages/server/supabase/migrations/20260428000300_org_access_policies.sql`
