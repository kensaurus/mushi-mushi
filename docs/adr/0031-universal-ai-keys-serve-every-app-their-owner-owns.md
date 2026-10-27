# 0031. Universal AI keys serve every app their owner owns

Status: Proposed Date: 2026-10-21

Related: migration `20261021051628_byok_keys_universal_scope.sql`,
`_shared/byok-scope.ts`, `_shared/byok.ts` (`resolveLlmKeys`,
`orderCandidates`), `_shared/spend-down.ts` (`firstCursorKeyFor`),
`_shared/spend-down-db.ts` (`keyProjects`), `api/routes/settings-research.ts`
(`/v1/admin/byok/keys*`), `api/routes/byok-spend-down.ts`,
`apps/admin/src/components/settings/ByokPanel.tsx`. Extends
[0023](0023-ai-keys-can-be-shared-by-every-app-in-an-organization.md); used by
[0028](0028-spend-down-expiring-agent-credits.md) and
[0030](0030-agent-pr-review-gate.md).

## Context

ADR 0023 let a key belong to one organization, so one key served every app
in it. The owner runs apps in more than one organization: the dogfood
organization holds 7 apps, and the `mushi-mushi` project sits in a second
organization. One Anthropic key could not serve both, so the agent PR review
(ADR 0030), which runs only on a project's own key, skipped every mushi-mushi
pull request with `no_anthropic_key`. The owner asked for one key that works
across the Mushi console, with "universal" as the default.

## Decision

- A `byok_keys` row has exactly one owner: `project_id`, `organization_id`,
  or the new `owner_user_id` (a **universal** key). The check constraint is
  `num_nonnulls(project_id, organization_id, owner_user_id) = 1`. The
  migration is additive.
- **Whose universal key serves an app:** the users with role **`owner`** in
  the app's organization. With several owners, all their universal keys form
  one group, ordered by priority (a tie between two owners' keys is resolved
  by the database's order, as within any pool group). An admin's universal key
  does not reach an organization they only administer, and a member's never
  does: nobody bills an organization they do not own. An app with no
  organization gets no universal keys (BL-096).
- **Resolver order** (extends ADR 0023's, which stays in force):
  1. the app's own pool keys;
  2. else its legacy `project_settings` credential;
  3. its organization's shared keys;
  4. the universal keys of its organization's owners;
  5. the platform env key, only when steps 1 to 4 found nothing.

  A universal key is marked `scope: 'universal'` and keeps `shared: true`, so
  every ADR 0023 consumer (`resolveCursorApiKey`, spend-down's
  `firstCursorKeyFor`, the agent PR review's "own key only" rule, which counts
  any `source: 'byok'` key) treats it like an organization key: after the
  app's own and legacy keys, never instead of them.
- **Cross-tenant guard.** The owner filter (`keyOwnerFilter`) adds
  `owner_user_id.in.(<the organization's owners>)`, read fresh from
  `organization_members`. After the query, every row goes through
  `keyScopeFor`, which drops a row the project may not use, so a universal key
  never serves another owner's organization even if a query returned it.
- **Spend-down.** A universal Cursor key with spend-down on pays for the apps
  of every organization its owner owns where it is the resolver's first pick
  (no own, legacy or organization Cursor key there). The tie rule is
  unchanged.
- **API.** `POST /v1/admin/byok/keys` takes
  `scope: 'universal' | 'organization' | 'project'`. Omitted, it is
  `project` for every caller, as before (amended after review 2026-10-21:
  the API default does not change; the universal default lives in the
  console form, which sends `scope: 'universal'` explicitly). A console user
  who does not own the organization cannot add a universal key from it
  (`UNIVERSAL_KEY_NEEDS_OWNER`), because it would not serve that app.
  `PATCH /v1/admin/byok/keys/:keyId/scope` moves a key between the three
  scopes (`POST` stays as an alias). Moves need an organization owner or
  admin in the console, as in ADR 0023. Moving to universal needs an owner of
  this organization **and the user who added the key** (`created_by`):
  otherwise an owner could take over a colleague's app or organization key as
  their own (409 `UNIVERSAL_KEY_NOT_YOURS`; add your own key instead). A
  universal key is moved, changed, tested, turned off or removed only by its
  owner (`UNIVERSAL_KEY_OWNER_ONLY`). Every move writes a `rescoped` row to
  `byok_audit_log` (`meta: { key_id, from, to }`); the action check gains
  `rescoped`.
- **What others see of a universal key.** It serves its owner's apps in
  several organizations, so nobody else learns about the other organizations
  through it. The spend-down status (`GET /v1/admin/byok/spend-down`) shows a
  non-owner (co-owner, admin, member, viewer, any API key) only the apps of the
  requesting app's organization, in `projects` and in the last worker summary
  (`scopeSpendDownView`), and `dispatchedToday` counts only that
  organization's dispatches while `remainingToday` is null; only the key's
  owner in the console sees them all.
  The credits route never decrypts another owner's universal key; its balance
  shows as unavailable.
- **CLI and MCP stay app-scoped.** They authenticate with a project API key,
  and ADR 0023 already keeps API keys from changing shared keys; a universal
  key reaches further still. `add_byok_key` and `mushi keys add` keep adding
  this app's key (no `--scope` flag), and an explicit `scope: 'universal'`
  from an API key is refused with `UNIVERSAL_KEY_CONSOLE_ONLY`.
  `list_byok_keys` and `mushi keys list` show each key's scope (BL-097).
- **Listing.** `GET /v1/admin/byok/keys` returns each key's `scope`; a
  universal key also carries `ownedByMe` and `servesThisApp`, never its
  owner's id. A console user also sees their own universal keys from an app
  they do not own, marked "not used in this app", so they can manage them
  anywhere. `universal: { canAdd, appCount, organizationCount }` drives the
  form.
- **Console.** The add form's "Use this key for" picker offers **All my
  apps** (selected by default when the user may add one), **This
  organization**, and **This app only**, with one line on the resolution
  order. Each key row shows its scope chip and a "Used by" picker; every move
  is confirmed first.
- **RLS.** A new `byok_keys_universal_owner_select` policy lets the owner
  select their own universal rows. The project and organization member
  policies match on `project_id` / `organization_id`, which are null on a
  universal row, so co-owners and members never read it (or its
  `vault_secret_id`) directly. Writes stay service-role only.

## Consequences

- One key serves every app the owner owns, across organizations; a new app in
  any of those organizations needs no key setup. mushi-mushi's PRs get the
  Opus review once the owner's key is universal.
- Spend from a universal key is still recorded per project in
  `llm_invocations`; per-project budgets are unchanged.
- Adding a co-owner to an organization makes their universal keys serve its
  apps after its own and shared keys. Removing an owner, or demoting them to
  admin, stops their universal keys there on the next call.
- Deploy order: apply the migration before deploying the functions. Code
  deployed first degrades instead of failing: `ownerUserColumnReady` probes
  the column once per client (a miss is retried after a minute), and until it
  exists every reader (resolver, key list, per-key routes, scope routes,
  credits, spend-down status and worker) leaves universal keys out, and
  adding or moving a key to universal answers 503 `UNIVERSAL_KEYS_UNAVAILABLE`.
- Vault cleanup: an `after delete` trigger on `byok_keys`
  (`private.byok_keys_delete_vault_secret`, security definer) deletes the
  row's Vault secret, so deleting a user (cascading to their universal keys),
  a project or an organization leaves no secret behind. A secret is not
  always one row's: on live data a pool row shared its secret with the
  project's legacy `byok_<provider>_key_ref`, which the resolver uses. So the
  trigger, and the pool-key DELETE route (now `vault_delete_secret_if_unused`
  instead of the unchecked `vault_delete_secret_by_id`), delete a secret only
  when `private.vault_secret_in_use` finds no `byok_keys` row and no `*_ref`
  column of `project_settings` or `organization_integration_settings`
  (listed from `information_schema` at call time) holding it, as the bare id
  or `vault://<id>`. A missing Vault privilege in the trigger raises a warning
  instead of blocking the delete. The legacy single-key routes still delete
  their secret by name (BL-098).
- Like organization keys, universal keys write no per-project health rows
  (`byok-health` skips keys without a `project_id`).

## Rejected

- **Grant table (key × organization).** More flexible, but every new app or
  organization would need a grant; the owner asked for "all my apps".
- **Universal keys for admins too.** It would let an admin bill an
  organization they do not own.
- **Universal before organization keys.** An organization key is the
  organization's explicit choice for its apps; a universal key is the
  owner's general fallback.
- **CLI `--scope universal` with a project API key.** Contradicts ADR 0023's
  "API keys never change shared keys".
