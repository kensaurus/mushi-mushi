# 0020. The local UX loop runs coding agents in the CLI process, behind a write guard

Status: Accepted (owner, 2026-10-06)            Date: 2026-10-06

Plan: [Plan 021](../execplans/ux-loop.md). Complements
[0013](0013-cloud-coding-agents-run-through-edge-adapters.md) (cloud agents
stay edge adapters). Bound by [0005](0005-treat-the-local-dev-backend-as-production.md),
[0006](0006-never-hand-authenticated-sessions-to-peer-agents.md) and the
"nothing acts on its own" exception of
[0017](0017-strike-the-plan-019-020-sequencing-gate.md).

## Context

The owner wants a loop that walks every screen of a running app (pages, tabs,
dialogs), hands one screen at a time to a coding agent of their choice
(Cursor with a Grok model to spend included credits, Claude Code, Codex),
measures the result, and shows it live. On 2026-10-06 the owner lifted the
act gate for this feature, local and cloud, inside 0017's exception.

Three facts shape where it runs. The agent has to edit the person's own
checkout and see their dev server, which no edge function can reach. ADR
0013 rejected a second Node runtime for *cloud* agents, but a local agent has
no edge equivalent. And a dev server usually talks to a real backend (0005),
so anything that clicks through the app can mutate real data.

## Decision

1. **Local agents run as subprocesses of the `mushi-ux` CLI**
   (`@mushi-mushi/ux`, proxied by `mushi ux`). The package is separate from
   `@mushi-mushi/cli` because it ships Playwright. Cloud runs (Plan 021
   Phase 4) go through the 0013 adapters; this ADR does not add a
   server-side Node worker.
2. **Edits land in a git worktree on `mushi-ux/<run>`**, served by its own dev
   server. Kept changes are commits; rejected ones are reverted. The person's
   checkout is never touched, and nothing merges: the run ends with a branch
   to open as a draft PR.
3. **Discovery and capture never write.** Every non-GET request is aborted
   unless it matches an explicit per-target allowlist. Forms are never
   submitted. Destructive-looking controls (delete, pay, send, log out, …) are
   never clicked.
4. **Keep or revert is decided by measurement, not by a model.** (Amended by [0021](0021-a-second-model-may-veto-a-kept-ux-step.md): a second model may veto a step the measurements kept, never keep a rejected one.) That means
   axe, sideways scroll, tap targets, console errors and layout shift, plus a
   pixel diff. The different-model review at the end is advisory and
   evidence-bound: every claim carries a box in the image, and images are shown
   in random order.
5. **Credential boundary (0006).**
   - The coding agent gets screenshots and a prompt file, never the browser
     profile, its path, or the Mushi CLI config.
   - Its environment is scrubbed of credentials except its own model key.
   - Claude Code runs `--restricted`, which removes shell tools and confines
     file access to the worktree.
   - The profile lives under the user's local app-data directory, outside
     every repo.

## Rejected alternatives

- **Run the agent in the person's checkout.** That would collide with their
  own edits and any other agent working there, and a bad run would leave a
  dirty tree.
- **Let a vision model decide keep or revert.** Published accuracy for
  screenshot-only UX critique is poor (Baymard: 80% error for GPT-4 audits;
  UICrit: 13% of zero-shot critiques valid). Measurements are repeatable; taste
  is not.
- **Fold it into `@mushi-mushi/cli`.** Playwright and a browser download would
  break the CLI's install-size budget.
- **Use `@cursor/sdk` local mode.** As of 2026-10, local runs on Windows fail
  (no sandbox; "unable to open database file"). The headless `agent -p` CLI is
  the adapter, until a Phase 0 probe says otherwise.

## Consequences

Residual risk, stated plainly: a non-Claude agent (Cursor, Codex) runs as the
same OS user with its own tools. "Screenshots only" is a policy for those
agents, not a sandbox, and Cursor's sandbox is unavailable on Windows.
Dogfooding on the Mushi console uses a dedicated non-owner test account,
because the console's dev server talks to production (0005). Apps that read
data through POST (PostgREST `rpc`, GraphQL) need allowlist entries, or their
screens render error states and are reported as blocked rather than "fixed".

## Addendum (2026-10-06): cloud runs on the host's CI

Edge functions cannot run a browser, so a console-started run executes on the
host's own GitHub Actions runner. This follows the ADR 0019 pattern: a host
workflow (`docs/templates/mushi-ux.yml`) that calls a public composite action
(`.github/actions/ux-loop`).

- **How Mushi starts it.** Mushi fires `repository_dispatch` (event
  `mushi-ux-run`) through the project's GitHub connection. That event needs
  only Contents: write, which the GitHub App already has; `workflow_dispatch`
  would need Actions: write.
  - Only a console JWT session can start it (`POST
    /v1/admin/projects/:pid/ux-runs/cloud`), never an API key, and at most 3
    per hour per app (ADR 0017).
  - The payload is a closed shape: agent, model id, numbers and paths, each
    validated on both sides.
  - The template's `workflow_dispatch` lets anyone with write access to the
    host repo start a run without the console. That is by design: it is their
    repo and their runner.
- **Only `cursor-cloud` runs on CI.** `actions/checkout` leaves a token with
  contents:write in `.git/config`. A local agent on the runner could read it;
  a Cursor Cloud agent edits on Cursor's side and never sees it.
- **The dev server runs code the agent edited.** That code can still read
  `.git/config` on the runner. What it could reach:
  - a job-scoped token that expires with the job, for a repo that Cursor's
    GitHub App can already push to.

  What it cannot reach: the dev server and install get the app's environment
  without this tool's own keys (`appEnv`: Cursor, Anthropic, OpenAI and GitHub
  tokens, `MUSHI_*`). This applies locally too.
- **Cursor pushes to the run branch itself.** `workOnCurrentBranch: true` keeps
  every push of a run under `mushi-ux/**`, so a single `branches-ignore` keeps
  the host's CI from running once per attempt.
- **Signed out.** A runner has no login profile, so a cloud run sees only the
  screens a signed-out visitor sees.
- **One draft PR per run**, opened with the workflow's `GITHUB_TOKEN`. Nothing
  merges.
