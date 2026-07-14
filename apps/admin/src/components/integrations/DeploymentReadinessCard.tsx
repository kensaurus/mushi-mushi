/**
 * FILE: apps/admin/src/components/integrations/DeploymentReadinessCard.tsx
 * PURPOSE: Closes the loop between "Mushi just dispatched a fix" and
 *          "the user reviewed + shipped it safely". The card surfaces
 *          three things the user explicitly asked for:
 *
 *            1. Branch-protection guidance for the `mushi/fix-*` branches
 *               the worker opens (so an auto-PR can't ship without review).
 *            2. Vercel / Netlify / Cloudflare preview integration so each
 *               fix PR ships a temporary preview the reviewer can click.
 *            3. AWS / GitHub-Actions deploy hints so production releases
 *               stay gated even when the fix worker is highly confident.
 *
 *          We deliberately do not auto-write to GitHub here -- this card
 *          is informational + copy-paste-able. The "Open settings" links
 *          deep-link straight to the right GitHub or Vercel page on the
 *          user's own repo, derived from the connected `repo_url`.
 */

import { useEffect, useMemo, useState } from 'react'
import { Btn, Tooltip } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { isGithubHostname } from '../../lib/githubUrl'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  /** Active project id -- the card fetches its own `repo_url` from
   *  `/v1/admin/projects/:id/codebase/stats` so the parent doesn't
   *  need to thread the value through. When null the card degrades
   *  to a "select a project first" state. */
  projectId: string | null
  /** Mushi GitHub App installed flag from the integrations payload.
   *  Drives the CTA copy -- a repo without the app needs to install
   *  it first before any of these guards become enforceable. */
  githubAppInstalled: boolean
  /** Vercel project slug for the deploy-preview shortcut. Optional --
   *  null falls back to a "Connect to Vercel" generic CTA. */
  vercelProjectSlug?: string | null
}

interface CodebaseStatsLite {
  repo_url: string | null
}

interface RepoCoords {
  owner: string
  repo: string
  base: string
}

/** Parses a `https://github.com/owner/repo` URL down to coords used
 *  to build the deep links. Returns null for non-GitHub repos so the
 *  card can degrade to read-only copy. */
function parseRepoUrl(url: string | null): RepoCoords | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (!isGithubHostname(u.hostname)) return null
    const [owner, repo] = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (!owner || !repo) return null
    return { owner, repo, base: `https://github.com/${owner}/${repo}` }
  } catch {
    return null
  }
}

/** Single item in the readiness checklist. Each renders the same shell:
 *  status pill, title, two-line description, primary deep-link CTA, and
 *  a small "copy this YAML" affordance for the GitHub Actions / Vercel
 *  snippets so the user can paste straight into their repo without
 *  visiting a third tab. */
interface ChecklistItem {
  key: string
  title: string
  status: 'ready' | 'recommended' | 'optional'
  description: string
  ctaLabel: string
  ctaHref: string | null
  snippetLanguage?: 'yaml' | 'json'
  snippet?: string
}

export function DeploymentReadinessCard({ projectId, githubAppInstalled, vercelProjectSlug }: Props) {
  // The integrations page already loads platform credentials, so this
  // card only needs the lightweight `repo_url` to build deep links.
  // We fetch the codebase stats endpoint (already populated for any
  // project with a connected repo) rather than threading a new prop
  // through useSetupStatus -- keeps the card self-sufficient and
  // friendly to drop-in usage elsewhere later.
  const [repoUrl, setRepoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!projectId) {
      setRepoUrl(null)
      return
    }
    let cancelled = false
    void (async () => {
      const res = await apiFetch<CodebaseStatsLite>(
        `/v1/admin/projects/${projectId}/codebase/stats`,
      )
      if (cancelled) return
      if (res.ok && res.data) setRepoUrl(res.data.repo_url ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const coords = useMemo(() => parseRepoUrl(repoUrl), [repoUrl])

  const items: ChecklistItem[] = useMemo(() => {
    if (!coords) {
      return [
        {
          key: 'connect-repo',
          title: 'Connect a GitHub repo first',
          status: 'recommended',
          description:
            'The Deployment Readiness checklist becomes actionable once your project is linked to a GitHub repo. Open the GitHub integration card above to connect.',
          ctaLabel: 'Scroll to GitHub card',
          ctaHref: null,
        },
      ]
    }

    const protectionUrl = `${coords.base}/settings/branches`
    const rulesetUrl = `${coords.base}/settings/rules/new`
    const actionsUrl = `${coords.base}/settings/actions`
    const requiredChecksUrl = `${coords.base}/settings/branches`
    const vercelHref = vercelProjectSlug
      ? `https://vercel.com/${vercelProjectSlug}/settings/git`
      : `https://vercel.com/new/git/external?repository-url=${encodeURIComponent(coords.base)}`

    return [
      {
        key: 'branch-protection',
        title: 'Protect `main` from auto-merging fix PRs',
        status: githubAppInstalled ? 'recommended' : 'optional',
        description:
          'Add a rule on `main` that requires at least one reviewer and a passing CI check. Mushi opens PRs as drafts, but a protected base branch is the belt-and-suspenders that stops a fast-clicked merge.',
        ctaLabel: 'Open branch protection settings',
        ctaHref: protectionUrl,
        snippetLanguage: 'yaml',
        snippet: [
          '# GitHub branch protection -- minimum rules for Mushi fix PRs',
          '# Repo Settings -> Branches -> Add rule (or use the new Rulesets API)',
          'branch_name_pattern: main',
          'rules:',
          '  - require_pull_request_reviews:',
          '      required_approving_review_count: 1',
          '      dismiss_stale_reviews: true',
          '  - require_status_checks:',
          '      strict: true',
          '      contexts: [ "ci/build", "ci/test" ]',
          '  - require_linear_history: true',
          '  - block_force_pushes: true',
        ].join('\n'),
      },
      {
        key: 'ruleset-mushi-branches',
        title: 'Apply a ruleset to `mushi/fix-*` branches',
        status: 'recommended',
        description:
          'Optional but high-leverage: a ruleset that restricts who can push to the `mushi/fix-*` branch namespace prevents accidental direct commits on top of an in-flight auto-fix. Pairs nicely with required status checks.',
        ctaLabel: 'Create a new ruleset',
        ctaHref: rulesetUrl,
        snippetLanguage: 'json',
        snippet: JSON.stringify(
          {
            name: 'mushi/fix-* branches',
            target: 'branch',
            enforcement: 'active',
            conditions: { ref_name: { include: ['refs/heads/mushi/fix-*'] } },
            rules: [
              { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
              { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci/build' }] } },
            ],
          },
          null,
          2,
        ),
      },
      {
        key: 'vercel-preview',
        title: 'Ship a Vercel preview on every fix PR',
        status: vercelProjectSlug ? 'ready' : 'recommended',
        description: vercelProjectSlug
          ? 'Connected -- each Mushi PR will get a unique preview URL that lands as a comment on the PR. Reviewers can click straight into the fix.'
          : 'Connect this repo to Vercel so each `mushi/fix-*` branch gets a preview deployment. Reviewers can verify the fix in a browser before approving.',
        ctaLabel: vercelProjectSlug ? 'Open Vercel git settings' : 'Connect to Vercel',
        ctaHref: vercelHref,
      },
      {
        key: 'gha-deploy',
        title: 'Gate AWS / production deploys behind passing checks',
        status: 'recommended',
        description:
          'If you deploy via GitHub Actions (AWS, GCP, Fly.io...), require the production-deploy workflow to depend on the unit-test + Mushi-PR-check job. The snippet below adds a `needs:` gate so a not-yet-reviewed fix can never trigger a deploy.',
        ctaLabel: 'Open Actions settings',
        ctaHref: actionsUrl,
        snippetLanguage: 'yaml',
        snippet: [
          '# .github/workflows/deploy.yml -- gate on the test job',
          'name: Deploy',
          'on:',
          '  push:',
          '    branches: [main]',
          'jobs:',
          '  test:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '      - run: pnpm install && pnpm test',
          '  deploy:',
          '    needs: test       # <-- never deploys if tests fail',
          '    runs-on: ubuntu-latest',
          '    environment: production   # require manual approval in repo settings',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '      - run: ./scripts/deploy.sh',
        ].join('\n'),
      },
      {
        key: 'required-checks',
        title: 'Require Mushi triage to pass before merge',
        status: 'optional',
        description:
          'Advanced: add `mushi/triage` as a required status check so a merge can only happen once Mushi has classified the report and confirmed the fix relates to it. Useful for teams that want a paper trail on every change.',
        ctaLabel: 'Configure required checks',
        ctaHref: requiredChecksUrl,
      },
    ]
  }, [coords, githubAppInstalled, vercelProjectSlug])

  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-fg">Deployment readiness</h3>
          <p className="text-2xs text-fg-muted mt-0.5 leading-relaxed">
            What to enable on your repo so every Mushi fix PR is reviewed and
            shipped safely. Each item is opt-in — pick the ones that match your
            release process.
          </p>
        </div>
        {coords && (
          <Tooltip content={`Linked to ${coords.owner}/${coords.repo}`}>
            <span className="text-2xs font-mono text-fg-faint truncate max-w-[14rem]">
              {coords.owner}/{coords.repo}
            </span>
          </Tooltip>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <ReadinessItem key={item.key} item={item} />
        ))}
      </ul>
    </div>
  )
}

const STATUS_TONE: Record<ChecklistItem['status'], { dot: string; pill: string; label: string }> = {
  ready: {
    dot: 'bg-ok',
    pill: CHIP_TONE.okSubtle,
    label: 'Ready',
  },
  recommended: {
    dot: 'bg-brand',
    pill: CHIP_TONE.brandSubtle,
    label: 'Recommended',
  },
  optional: {
    dot: 'bg-fg-faint',
    pill: CHIP_TONE.neutral,
    label: 'Optional',
  },
}

function ReadinessItem({ item }: { item: ChecklistItem }) {
  const tone = STATUS_TONE[item.status]
  const copySnippet = () => {
    if (!item.snippet) return
    try {
      void navigator.clipboard?.writeText(item.snippet)
    } catch {
      // intentionally swallow -- clipboard is best-effort here, the
      // raw snippet is still visible in the disclosure below.
    }
  }
  return (
    <li className="rounded-sm border border-edge-subtle bg-surface-raised p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot}`} />
            <span className="text-sm font-medium text-fg">{item.title}</span>
            <span className={`text-2xs font-mono px-1.5 py-0.5 rounded-sm border ${tone.pill}`}>
              {tone.label}
            </span>
          </div>
          <p className="text-2xs text-fg-muted mt-1 leading-relaxed">{item.description}</p>
        </div>
        {item.ctaHref && (
          <a
            href={item.ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-sm ${CHIP_TONE.brandSubtle} hover:bg-brand/20`}
          >
            {item.ctaLabel} <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {item.snippet && (
        <details className="mt-2">
          <summary className="cursor-pointer text-2xs font-mono text-fg-muted hover:text-fg">
            Copy paste snippet
          </summary>
          <div className="mt-1 relative">
            <pre className="mushi-code-block mushi-code-body text-2xs font-mono border border-code-surface-border rounded-sm p-2 overflow-x-auto whitespace-pre">
              {item.snippet}
            </pre>
            <Btn
              variant="ghost"
              size="sm"
              onClick={copySnippet}
              className="absolute top-1 right-1 text-2xs"
            >
              Copy
            </Btn>
          </div>
        </details>
      )}
    </li>
  )
}
