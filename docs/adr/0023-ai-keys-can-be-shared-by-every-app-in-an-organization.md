# 0023. AI keys can be shared by every app in an organization

Status: Accepted (owner, 2026-10-10) Date: 2026-10-10

Related: migration `20261010130000_byok_keys_org_scope.sql`,
`_shared/byok-scope.ts`, `_shared/byok.ts` (`resolveLlmKeys`),
`api/routes/settings-research.ts` (`/v1/admin/byok/keys*`),
`apps/admin/src/components/settings/ByokPanel.tsx`.

## Context

A `byok_keys` row belonged to one project. One owner with nine apps in one
organization had to paste the same Firecrawl, Anthropic or OpenAI key into
each app's **Settings → AI keys**. On 2026-10-10 glot.it had a working
Firecrawl key (92k credits) and the other eight apps had none, so every
Firecrawl feature in those apps was idle. The owner asked why a key could not
be used by every project.

Integrations already had an organization level (`organization_integrations`,
merged into each project's setup signals). Keys did not.

## Decision

- A `byok_keys` row has exactly one owner: `project_id` (as before) **or**
  `organization_id`. A check constraint enforces "one, not both".
  The migration is additive: existing rows keep `project_id`.
- `resolveLlmKeys` (and every other key reader) uses one filter,
  `keyOwnerFilter`: the project's own keys, then its organization's.
  `ownKeysFirst` puts the project's own keys first; priority orders keys
  within each group. A shared key is therefore the fallback or backup, never
  a replacement for an app's own key.
- Adding, moving, testing, turning off, changing the expiry of, or removing
  a shared key requires organization **owner or admin**
  (`SHARED_KEY_ADMIN_ONLY`, 403), because it changes what every app bills
  to. Members see shared keys in the list, read-only.
- `POST /v1/admin/byok/keys` takes `scope: 'project' | 'organization'`.
  `POST /v1/admin/byok/keys/:keyId/scope` moves a key between this project
  and its organization. Only this project's key can go up, and only this
  organization's key can come back down.
- The console's add form offers "Use for all N apps", ticked by default for
  owners and admins. That is the case the owner asked for. Each key row has
  **Use in all apps** / **Use in this app only**.
- The owner filter is a PostgREST `.or()` string. Ids containing filter
  syntax are refused, and a test pins the filter to `byok_keys` chains only.
  Other tables have no `organization_id`.
- The CLI and MCP `add` commands keep adding app keys. Sharing is a console
  action.

## Consequences

- One key serves every app; adding a new app needs no key setup.
- Spend from a shared key is still recorded per project in `llm_invocations`.
  Credits checks show the shared key's provider balance on each app.
- Per-project budget enforcement (`monthly_llm_budget_usd`) is unchanged.
  It counts calls, not keys.
- Turning off or removing a shared key affects every app, and the
  confirmation says so.
- Org-level health rows: `byok-health` skips keys without a `project_id`
  when writing per-project integration health. Shared keys show their state
  on the AI keys tab, not on the project health strip.
