# Design: Org-Scoped MCP Access

**Status:** design only — deliberately NOT shipped alongside the hosted-OAuth
default (Phase 3.1 of the 2026-07 GTM uplift). Written 2026-07-08.

## Problem

Every MCP credential today is a `project_api_keys` row: one key ↔ one project.
The OAuth consent page (`/mcp-auth`, handled by `mcp-oauth.ts`) makes the user
pick exactly one project, and the minted access token IS that project's API
key. A developer with 6 projects gets 6 server entries (`mushi setup
--all-projects`) or re-runs consent per project. Sentry's hosted MCP is
org-scoped: one login, all projects, tools take a project/org parameter.

## Constraint that shapes everything

The MCP token is not a session — it is a **revocable `project_api_keys` row**.
That gives us free revocation UX (Projects → Keys), audit logging, and scope
enforcement reusing the existing key middleware. Org scope must keep those
properties or it regresses security.

## Options

### A. Org-level key table (`org_api_keys`)

New table mirroring `project_api_keys` with `org_id` instead of `project_id`.
Key middleware resolves org keys to the set of member projects on each call.

- ✅ Clean model; single revocable row; org-wide audit story.
- ❌ New table + RLS + middleware branch through ~50 edge functions that
  currently assume `project_id` context; every MCP tool needs an explicit
  `project` parameter (or "all projects" semantics) — a catalog-wide change
  (~80 tools).

### B. Multi-project consent minting (composite grant)

Keep `project_api_keys`. The `/approve` handler in `mcp-oauth.ts` lets the
user check N projects; it mints one key row per project, all sharing a
`grant_id`, and the access token maps to the grant. The MCP server resolves
the grant to its key set and routes each tool call by a `project` argument
(default: the grant's primary project).

- ✅ No new auth model; per-project rows keep existing revocation/audit;
  revoking the grant revokes all rows.
- ❌ Grant indirection table still needed; token→keys resolution adds a
  lookup per request; "which project is this tool call for" still lands on
  the tool surface.

### C. Session-scoped project switching (cheapest)

One project key (as today) plus a `switch_project` MCP tool that re-runs a
lightweight consent (already-authorized projects skip the browser). The
server swaps the active key server-side within the session.

- ✅ No schema change; smallest diff (mcp-oauth.ts + one tool).
- ❌ Not truly org-scoped: concurrent multi-project queries impossible;
  agent workflows that fan out across projects still stall on switching.

## Recommendation

**Option B.** It preserves the "token IS a revocable key row" invariant,
reuses all existing middleware, and the incremental cost (grant table +
consent-page multi-select + `project` parameter on cross-project tools) is
bounded. Option A is the right end-state only if org-level RBAC (Bucket C /
EE) ships first; Option C is a stopgap that burns the consent UX twice.

## Implementation sketch (Option B)

1. Migration: `mcp_oauth_grants` (id, user_id, created_at, revoked_at) +
   `grant_id uuid null` column on `project_api_keys`.
2. `mcp-oauth.ts` `/approve`: multi-select project list → mint N rows with
   shared `grant_id`; access token payload carries `grant_id` instead of a
   single key.
3. Hosted MCP middleware: resolve `grant_id` → active key rows → allowed
   project set; reject tool calls naming a project outside the set.
4. Tool surface: add optional `project` param to the ~15 cross-project-useful
   tools first (`get_recent_reports`, `search_reports`, `triage_issue`, …);
   default remains the primary project so single-project users see no change.
5. Console: Keys page groups rows by grant with a "revoke all" action.

## Non-goals

- No org-wide write scopes in v1 (dispatch/merge stay per-project).
- No SCIM / team-role interaction (Bucket C, EE boundary).
- Self-hosted single-tenant deployments gain nothing here; feature is
  hosted-cloud-first.
