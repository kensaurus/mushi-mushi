# 0043. SDK upgrade PRs update npm lock entries when the host has no lockfile workflow

Status: Proposed            Date: 2026-10-23

Amends [0019](0019-sdk-upgrade-lockfile-helper.md) for npm lockfiles only.
Related: [0016](0016-mushi-as-the-app-recipe-control-plane.md) (the GitHub App
still does not receive `workflows`).

## Context

ADR 0019 sends hosts that have `.github/workflows/mushi-sdk-lockfile.yml`
through `awaiting_lockfile`, and leaves every other host with a package.json
bump and a link to the docs. On 2026-10-23 the console's "Upgrade to 1.33.1"
opened upgrade PRs for glot.it (#303), help-her-take-photo (#137),
the-wanting-mind (#224) and solo-boss-cloud-documentation (#793). None of
those repos had the workflow. All four failed `npm ci` with
`lock file's @mushi-mushi/core@1.31.0 does not satisfy @mushi-mushi/core@1.33.2`,
and the hosts' freshness check failed every other open PR on the same
repositories.

A hand fix on those PRs was `npm update @mushi-mushi/<pkg> --package-lock-only --ignore-scripts`:
about fifteen lines, only the `@mushi-mushi/*` entries (version, resolved,
integrity, and the ranges that depend on them).

0019 rejected editing a lockfile in the edge function because pnpm v9 keys
carry peer-dependency suffixes and the workers cannot spawn npm. That still
holds for pnpm and yarn. An npm lockfileVersion 2 or 3 entry for one exact
version is the registry packument's tarball URL and integrity, which the
worker can copy without running npm.

## Decision

1. **The awaiting_lockfile path is unchanged.** A repo whose default branch
   has the workflow still gets one bump commit and a PR after the workflow
   pushes, or after 30 minutes.
2. **With no workflow, and a `package-lock.json` or `npm-shrinkwrap.json` of
   lockfileVersion 2 or 3**, the same commit updates the
   `node_modules/@mushi-mushi/<pkg>` entries the bump reaches: `version`,
   `resolved` and `integrity` from the npm packument for that exact version,
   the host manifest ranges, and the `@mushi-mushi/*` ranges inside those
   entries (including a transitive `@mushi-mushi/core` required by
   `@mushi-mushi/web`). A transitive package whose locked version already
   satisfies the new range stays. A nested copy is rewritten only when the
   chosen version satisfies the range its parent entry declares; otherwise
   the lockfile is left unchanged and the job falls back to the manual npm
   command, so a 0.x copy kept for an incompatible range is not moved. A
   lockfileVersion 1 file, or a new non-`@mushi-mushi` dependency the lock
   cannot satisfy, is not guessed.
3. **pnpm and yarn lockfiles are not edited.** The PR body and the console
   Update center say this PR needs `pnpm install --lockfile-only` (yarn:
   `yarn install`). The PR still opens so the bump is reviewable; CI stays
   red until that command's lockfile is pushed.
4. **No npm or pnpm process runs in the edge function.** The edit is a JSON
   patch. The workflow remains the way a host refreshes every lockfile with
   the package manager CLI.

## Consequences

- New upgrade PRs on npm repos without the workflow can pass `npm ci`.
- Hosts on pnpm or yarn see the command in the PR and in the Update center
  instead of a bump that looks finished.
- 0019's rejection of hand-edited pnpm lockfiles, and of writing
  `.github/workflows` into a host, still stands.
