# 0026. One MCP connection reaches all, or selected, projects

Status: Accepted (owner, 2026-10-12) Date: 2026-10-12

Related: migration `20261012030000_mcp_account_key_selected_projects.sql`,
`api/routes/mcp-oauth.ts`, `_shared/key-project-scope.ts`,
`_shared/mcp-connection-scope.ts`, `mcp/index.ts`,
`api/routes/mcp-admin.ts` (account keys), `apps/admin/src/pages/McpAuthPage.tsx`,
`apps/admin/src/components/mcp/McpAccountKeysList.tsx`;
migration `20260617013908_mcp_org_scoped_keys.sql` (account keys);
supersedes the Option B recommendation in
`docs/strategy/org-scoped-mcp-design.md`.

## Context

The MCP OAuth consent page minted one project key per login. A user with
several apps had to log in once per project, and each login added another
MCP server entry. The owner asked for one connection that reaches every
project, like the Supabase MCP server. Supabase's login reaches every project
in the chosen organization, and `?project_ref=` narrows a connection to one
project ([docs](https://supabase.com/docs/guides/ai-tools/mcp), read
2026-10-12).

Account keys (`project_api_keys.is_org_scoped = true`, `project_id` NULL)
already existed: the auth middleware accepts them, `callerProjectIds` lists
every project the key's owner can reach, and the key acts with the owner's
real role in each project. Only the consent page could not mint one, so the
strategy doc's grant table (Option B) is not needed.

## Decision

- **The consent page offers three grants.**
  - *All my projects* mints an account key (label `mcp-oauth-account`) that
    reaches every project the user can reach, now and later. It is the
    default when the user can see more than one project.
  - *Only the projects I pick* mints an account key limited to the ticked
    projects (label `mcp-oauth-selected`).
  - *One project* mints a project key (label `mcp-oauth`), as before. It
    stays owner/admin only, because a project key acts as the project's
    owner.
  - Account keys act with the user's own role in each project, so a member
    can grant them. They carry only `mcp:read` / `mcp:write`, since account
    keys cannot ingest reports.
- **A limited key is enforced at the two access primitives.**
  - `allowed_project_ids uuid[]` sits on account keys only (CHECK: 1–200
    ids).
  - `adminOrApiKey` runs the rest of the request inside an AsyncLocalStorage
    scope. `accessibleProjectIds` and `userCanAccessProject` intersect with
    it, so every route inherits the limit; about 50 call sites need no code.
    The scope is bound to the request, not the user.
  - A limited key acts on an organization only through a pinned project it
    is allowed (`resolveAccessibleOrg`). Organization-wide views and changes
    (`/v1/admin/orgs/:orgId/*`, `portfolioAccess`: portfolio, connectors,
    connector actions, accounts register, spend, project groups) and the
    operator company funnel (`/v1/admin/growth/funnel`) are refused
    for it (`KEY_LIMITED_TO_PROJECTS`), because they reach beyond its
    projects.
- **The hosted MCP knows which projects a connection reaches.**
  - An account connection always lists `list_projects` and
    `get_account_overview`, whatever `?features=` says. Its instructions and
    "projectId is required" errors tell the agent to call `list_projects`
    and pass `projectId`.
  - `?project=<uuid>` pins a connection to one project, like Supabase's
    `project_ref`. The pin is checked against what the credential reaches.
    A call naming another project is refused, the account and
    organization-wide tools are hidden, and the API refuses report reads
    outside a pinned project and organization-wide routes
    (`CONNECTION_PINNED_TO_PROJECT`) for account keys.
  - A NULL project is never forwarded as `X-Mushi-Project-Id`. It used to
    make every list route answer with nothing for account keys.
- **Account keys are listed and revoked** under MCP → Account keys
  (`GET` / `DELETE /v1/admin/mcp/account-keys`), owner only. No project's
  Keys page lists them.

## Rejected

- *A grant table with one project key per project* (strategy doc Option B).
  It adds an indirection table and a lookup per request for something
  account keys already do.
- *A `switch_project` tool* (Option C). It cannot query several projects at
  once.

## Consequences

- An all-projects key reaches projects the user joins later. The consent page
  says so; *Only the projects I pick* is the narrow choice.
- Each login mints a new key; the Account keys list makes them visible and
  revocable.
- An account key used with a pinned project (`X-Mushi-Project-Id`, stdio
  `MUSHI_PROJECT_ID`) can no longer open a report in another project or use
  organization-wide routes; use it without a pin for the portfolio.
- A key limited to selected projects cannot use the portfolio or other
  organization-wide routes; the hosted MCP does not list those tools for it.
