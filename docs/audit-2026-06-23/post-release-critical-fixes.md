# Post-release critical fixes — Jun 2026 SDK pipeline release

**Scope:** `@mushi-mushi/cli`, `@mushi-mushi/web`, `@mushi-mushi/react-native`, Teams webhook SSRF guard  
**Trigger:** Post-release code review after the Jun 2026 SDK pipeline + console connect release ([PR #230](https://github.com/kensaurus/mushi-mushi/pull/230))  
**Shipped in:** [PR #233](https://github.com/kensaurus/mushi-mushi/pull/233) → Version PR [#234](https://github.com/kensaurus/mushi-mushi/pull/234)  
**Published:** `@mushi-mushi/cli@0.22.1`, `@mushi-mushi/web@1.21.1`, `@mushi-mushi/react-native@0.20.1` (2026-06-23)

This document is the operator/dev handoff for issues found **after** the big pipeline release shipped. Read it before touching env bootstrap, web rewards listeners, RN i18n types, or Teams webhook settings.

---

## Summary table

| ID | Severity | Area | Symptom | Shipped fix | Version |
|----|----------|------|---------|-------------|---------|
| C1 | **CRITICAL** | CLI | `mushi project create` wiped `.env.local` | Merge-only write in `project-bootstrap.ts` | `cli@0.22.1` |
| C2 | **CRITICAL** | Web SDK | Duplicate reward/activity events; listener leak | Install-once guard in `rewards.ts` | `web@1.21.1` |
| C3 | **CRITICAL** | React Native | Published types broken for `@mushi-mushi/web/i18n` | Deleted `web-i18n.d.ts` shim | `react-native@0.20.1` |
| H4 | **High** | MCP + API | Org-scoped keys rejected on reporter-comms tools | Admin route twins + `reporter-comms.ts` + MCP repoint | Deployed `api` + `mcp` (Jun 23 2026) |
| H5 | **Medium** | Cursor MCP | Duplicate workspace `mushi` entries shadowed global fix | Clear workspace `mcp.json`; CLI global-conflict guard | `project-bootstrap.ts` (Jun 24 2026) |
| S1 | **CRITICAL** (already on master before #233) | Server | Teams webhook SSRF + response-body exfil | Write-time URL allowlist + no body reflection | Shipped in #230 |

---

## C1 — CLI `.env.local` clobber (data loss)

### Symptom

A developer runs `mushi project create` (or any flow that calls `writeProjectBootstrapFiles`) **inside an existing app** that already has a `.env.local` with `DATABASE_URL`, `NEXT_PUBLIC_*`, Stripe keys, etc. After the command, only three Mushi vars remain — everything else is gone.

### Root cause

`packages/cli/src/project-bootstrap.ts` used `writeFile(envPath, mushiLinesOnly)` with no read/merge step. That path was introduced when project bootstrap was extracted from `init.ts` during the 0.22.0 pipeline release. **`mushi init` was safe** (merge + confirm in `init.ts`); **`mushi project create` was not**.

### Fix (0.22.1)

Merge, never clobber:

1. `readFile('.env.local')` in one attempt; treat `ENOENT` as empty file.
2. Strip only prior `MUSHI_*` lines (bare **and** framework-prefixed: `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`) plus the `# Mushi MCP` comment block.
3. Append a fresh Mushi block at the end.
4. Re-runs are idempotent.

**Canonical reference:** same strip regex as `packages/cli/src/init.ts` (`MUSHI_LINE_RE` around line 588).

```typescript
// packages/cli/src/project-bootstrap.ts — merge contract
const MUSHI_LINE_RE = /^(NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_|EXPO_PUBLIC_)?MUSHI_[A-Z_]+=.*/gm
```

### CodeQL follow-up (TOCTOU)

The first patch used `existsSync()` then `readFile()`. CodeQL flagged `js/file-system-race` on the PR. **Do not reintroduce `existsSync` before read/write.** Use try/catch on `readFile` only; `envUpdated` is inferred from a successful read.

### How to verify

```bash
# In a temp dir with an existing .env.local
echo 'DATABASE_URL=postgres://local' > .env.local
echo 'STRIPE_SECRET_KEY=sk_test_x' >> .env.local
# Run project bootstrap (via mushi project create or unit test)
grep DATABASE_URL .env.local   # must still exist
grep MUSHI_PROJECT_ID .env.local # must exist
```

### Regression guard

Any new code path that writes `.env.local` must **merge** like `init.ts` / `project-bootstrap.ts`, never truncate. `mushi connect --fix` and `init` already merge; keep them aligned.

---

## C2 — Web rewards listeners re-installed on every `identify()`

### Symptom

With `rewards.enabled` + `trackActivity: true`, calling `Mushi.identify()` or `identifyWithToken()` more than once per page session:

- `history.pushState` gets wrapped **again** on top of the already-wrapped function.
- Duplicate `popstate`, `click`, and `MutationObserver` handlers attach.
- Activity events (`screen_view_unique_per_day`, `element_selected`, `session_minute`) **double-count** → inflated points / wrong tier progress.

### Root cause

`initRewards()` runs on every identify via `wireRewardsForIdentifiedUser()` in `packages/web/src/mushi.ts`. It always called `installActivityListeners(projectId)` when `trackActivity` is on, with no dedup guard. Timers (`flushTimer`, `dwellTimer`) were correctly cleared/restarted; DOM hooks were not.

### Fix (1.21.1)

Module-level `listenersInstalled` flag:

```typescript
// packages/web/src/rewards.ts
let listenersInstalled = false;

function installActivityListeners(projectId: string): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  // ... pushState wrap, popstate, MutationObserver, click ...
}

function removeActivityListeners(): void {
  listenersInstalled = false;
  // ... restore origPushState, remove handlers ...
}
```

`teardown()` → `removeActivityListeners()` resets the flag so a full SDK teardown + re-init on the same page can install again.

### What still re-runs on identify (by design)

- `updateRewardsUser()` — user id / traits / reporter token
- Flush and dwell **timers** — cleared and restarted with current config
- Tier cache invalidation

Only **DOM/route/click hooks** are install-once.

### How to verify

1. Enable rewards + `trackActivity` in widget config.
2. In browser devtools, call `Mushi.identify('user-a')` twice.
3. Navigate SPA routes; confirm one `screen_view_unique_per_day` per unique route per day (not 2×).
4. Optional: breakpoint in `installActivityListeners` — second identify must not enter the body.

---

## C3 — React Native `web-i18n.d.ts` broke published types

### Symptom

Consumers of `@mushi-mushi/react-native` who import from `@mushi-mushi/web/i18n` get TypeScript errors after `npm install` (path `../../web/src/i18n/types` does not exist in the published tarball).

### Root cause

`packages/react-native/src/web-i18n.d.ts` was an ambient module declaration:

```typescript
declare module '@mushi-mushi/web/i18n' {
  export type { MushiLocale } from '../../web/src/i18n/types'  // monorepo-only path
}
```

That path resolves in the monorepo but **not** on npm. With `moduleResolution: "bundler"`, the shim **shadowed** the real types from `@mushi-mushi/web`'s `exports` map.

### Fix (0.20.1)

**Deleted** `web-i18n.d.ts`. `@mushi-mushi/web` already publishes:

```json
"./i18n": {
  "types": "./dist/i18n/index.d.ts",
  "import": "./dist/i18n/index.js",
  "require": "./dist/i18n/index.cjs"
}
```

RN depends on `@mushi-mushi/web` (`workspace:^` / semver on publish). DTS build resolves `@mushi-mushi/web/i18n` directly.

### Regression guard

**Never** add ambient `declare module '@mushi-mushi/web/…'` shims with relative paths into sibling package **source** trees. If a subpath needs types, ensure the **published** package's `exports` + `dist/*.d.ts` are correct.

### How to verify

```bash
pnpm exec turbo run build --filter=@mushi-mushi/react-native
# DTS step must succeed without web-i18n.d.ts
```

---

## S1 — Teams webhook SSRF (shipped in #230, verified on master)

These were flagged in the same post-release review but were **already fixed** before PR #233. Documented here so reviewers don't re-open them.

### Write-time validation

`packages/server/supabase/functions/api/routes/settings-research.ts`:

- `validateWebhookUrl()` on PATCH for `slack_webhook_url`, `discord_webhook_url`, `teams_webhook_url`.
- Requires `https:` protocol.
- Host suffix allowlist per field (Teams: `office.com`, `logic.azure.com`, `powerplatform.com`).

Migration comment in `20260622075328_teams_webhook_url.sql` matches this behavior.

### Test endpoint — no response-body reflection

`packages/server/supabase/functions/_shared/teams.ts` → `sendTeamsTestMessage()`:

- On HTTP error, returns `HTTP ${status}` only.
- Cancels response body (`res.body?.cancel()`) — does **not** slice/return remote body to the caller (SSRF exfil channel).

Matches Slack/Discord test helpers.

---

## Release workflow lessons (same session)

These are operational, not product bugs. Full runbook: [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) §1.

### Stale local release branch

After squash-merge, a local branch like `release/sdk-pipeline-connect-jun-2026` can show **100+ uncommitted files** that were never part of the merged PR (concurrent agent edits + version drift). **Safe cleanup:** checkout `master`, `git pull`, discard the stale branch. Canonical state is always `origin/master`.

### Version Packages PR — CI doesn't auto-run

The `changeset-release/master` branch is created/updated by `github-actions[bot]`. That token **does not trigger** required checks. Before merging the version PR:

```bash
# Push empty commit with a user/PAT token to trigger Build & Test
gh api -X POST repos/kensaurus/mushi-mushi/git/commits ...  # or git push from authenticated client
```

Then admin-merge once `Build & Test` is green.

### `[skip ci]` suppresses publish after version merge

If the version PR squash commit includes `[skip ci]` (e.g. from a changelog refresh sub-commit), **`release.yml` won't run on push**. Fix:

```bash
gh workflow run release.yml --ref master
```

### Post-publish red ❌ on "Audit signatures"

The publish job can **fail on `npm audit signatures`** when the registry CDN hasn't propagated the new manifest yet (`ETARGET` after 7 retries). **npm packages and GitHub releases are often already live.** Confirm with:

```bash
npm view @mushi-mushi/cli version
gh release list --limit 5
```

### Changelog gate on fix PRs

Any PR that adds `.changeset/*.md` files must regenerate the public changelog **before** CI:

```bash
pnpm changelog:aggregate
git add CHANGELOG.md apps/docs/data/changelog.json
```

Use changeset bodies with `# vX.Y.Z — …` headline + `- **Highlight**:` bullets so the pending section renders correctly.

### Docs deploy — build MCP first

`deploy-docs.yml` must build `@mushi-mushi/mcp` before `@mushi-mushi/docs` (fixed in #232). `/connect` imports `@mushi-mushi/mcp/clients` → `dist/clients.js`.

### CloudFront apex redirect (known infra, not fixed)

Admin/docs deploy can fail at "Attach apex redirect cache behaviors" when behavior count exceeds CloudFront quota (~25 default). Tracked separately from SDK fixes.

---

## H4 — Org-scoped MCP keys rejected on reporter-comms tools

### Symptom

`get_report_timeline`, `reply_to_reporter`, or `get_two_way_comms_health` returned:

```
[ORG_KEY_NOT_ALLOWED] Org-scoped keys cannot be used for SDK ingest. Use a project-scoped key.
```

### Root cause

MCP tools called `/v1/sync/*` (`apiKeyAuth`), which rejects `is_org_scoped` keys. Reporter replies and two-way health are admin operations.

### Fix

- New `_shared/reporter-comms.ts` (`postReporterReply`, `computeTwoWayHealth`)
- Admin twins: `POST /v1/admin/reports/:id/reply`, `GET /v1/admin/two-way-health`
- MCP stdio + hosted manifest repointed to `/v1/admin/*`
- Deployed: `api` + `mcp` edge functions (Jun 23 2026)

**Full reference:** [`docs/operators/reporter-comms-and-mcp-setup.md`](../../docs/operators/reporter-comms-and-mcp-setup.md)

---

## H5 — Duplicate `mushi` entries in multi-workspace Cursor

### Symptom

After H4 deploy + MCP toggle, tools still returned `ORG_KEY_NOT_ALLOWED`. Backend curl returned 200; local dist was correct.

### Root cause

Four host repos each had `.cursor/mcp.json` with bare key `mushi` pinned to `@mushi-mushi/mcp@0.17.0`. With all workspaces open, Cursor routed `user-mushi` to a workspace entry calling `/v1/sync/*`.

`mushi project create` wrote workspace `mushi` without checking `~/.cursor/mcp.json`.

### Fix

- Cleared workspace `.cursor/mcp.json` in glot.it, yen-yen, the-wanting-mind, help-her-take-photo
- `project-bootstrap.ts`: `globalCursorMcpHasMushi()` skips workspace write when global `mushi` exists
- `commands/project.ts`: prints skip message + `project_id` hint

**Full reference:** [`docs/operators/mcp-multi-project.md`](../../docs/operators/mcp-multi-project.md)

---

## PR / commit map

| Artifact | Link / SHA |
|----------|------------|
| Main SDK pipeline release | PR #230 → `90bc9d59` squash on master |
| Docs MCP prebuild | PR #232 |
| Critical fixes | PR #233 → `5feac27d` |
| Version bump | PR #234 → `1977469d` |
| Published tags | `@mushi-mushi/cli@0.22.1`, `@mushi-mushi/web@1.21.1`, `@mushi-mushi/react-native@0.20.1` |

---

## Checklist for the next similar release

- [ ] Post-release code review on **published** packages, not just the PR diff.
- [ ] Any new `.env*` writer: merge test with pre-existing vars.
- [ ] Any `init*` that runs on identify/auth refresh: idempotent side effects (listeners, not just state).
- [ ] No monorepo-relative paths in published `.d.ts` shims.
- [ ] Webhook URLs: validate at write time; never reflect fetch bodies in test routes.
- [ ] Changesets + `pnpm changelog:aggregate` on the PR.
- [ ] Version PR: trigger CI before merge; dispatch `release.yml` if `[skip ci]` blocked publish.
- [ ] Confirm npm + GitHub releases even if signature-audit step is red.

---

## Related files

| Topic | File |
|-------|------|
| Env merge (project create) | `packages/cli/src/project-bootstrap.ts` |
| Env merge (init wizard) | `packages/cli/src/init.ts` |
| Rewards listeners | `packages/web/src/rewards.ts`, `packages/web/src/mushi.ts` |
| Web i18n exports | `packages/web/package.json` → `./i18n` |
| RN bottom sheet i18n import | `packages/react-native/src/components/MushiBottomSheet.tsx` |
| Webhook SSRF guard | `packages/server/supabase/functions/api/routes/settings-research.ts` |
| Teams test helper | `packages/server/supabase/functions/_shared/teams.ts` |
| Reporter comms shared logic | `packages/server/supabase/functions/_shared/reporter-comms.ts` |
| Admin reporter routes | `packages/server/supabase/functions/api/routes/reports.ts` |
| MCP admin repoint | `packages/mcp/src/server.ts`, `hosted-tool-manifest.json` |
| MCP global conflict guard | `packages/cli/src/project-bootstrap.ts` |
| Operator guide (H4/H5) | `docs/operators/reporter-comms-and-mcp-setup.md` |
| Multi-project MCP guide | `docs/operators/mcp-multi-project.md` |
| Release runbook | `docs/DEPLOYMENT.md` |
