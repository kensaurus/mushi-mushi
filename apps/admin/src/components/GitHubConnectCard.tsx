/**
 * FILE: apps/admin/src/components/GitHubConnectCard.tsx
 * PURPOSE: One "Connect GitHub" for an app, used by setup, Integrations and
 *          Connect: install (or reuse) the Mushi GitHub App, sign in to GitHub
 *          once so Mushi can check the installation is yours, then pick the
 *          repository. Every outcome ends on a plain next step.
 *
 * Flow and security: lib/githubConnect.ts, api/routes/github-connect.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Btn, Card, ErrorAlert, Input } from './ui'
import { apiFetch } from '../lib/supabase'
import {
  forgetGithubGrant,
  githubConnectMessage,
  listPickableRepos,
  repoFullName,
  requestConnectLinks,
  saveRepo,
  takeGithubGrant,
  type GithubConnectReturn,
  type RepoList,
  type SavedRepo,
} from '../lib/githubConnect'

interface Props {
  projectId: string
  /** The page GitHub returns to after signing in. */
  returnTo: GithubConnectReturn
  /** The app's repository today, if any. */
  currentRepoUrl?: string | null
  /** Called after a repository is saved. */
  onConnected?: (repo: SavedRepo) => void
  className?: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'loading' }
  | { kind: 'picking'; list: RepoList }
  | { kind: 'saving'; list: RepoList; fullName: string }
  | { kind: 'done'; repo: SavedRepo }

const SEARCH_FROM = 8

export function GitHubConnectCard({ projectId, returnTo, currentRepoUrl, onConnected, className = '' }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const [grant, setGrant] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  // The caller may not know the app's repository; read the primary one.
  const [loadedRepoUrl, setLoadedRepoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (currentRepoUrl !== undefined) return
    let live = true
    void apiFetch<Array<{ repo_url: string; is_primary: boolean }>>(`/v1/admin/repo/repos?project_id=${projectId}`, { cache: 'no-store' })
      .then((res) => {
        if (!live || !res.ok || !res.data) return
        setLoadedRepoUrl((res.data.find((r) => r.is_primary) ?? res.data[0])?.repo_url ?? null)
      })
    return () => { live = false }
  }, [projectId, currentRepoUrl])

  // A failed round-trip comes back as ?github_error=…; show it once.
  const returnedError = searchParams.get('github_error')
  useEffect(() => {
    if (!returnedError) return
    setError({ code: returnedError, message: githubConnectMessage(returnedError) })
    const next = new URLSearchParams(searchParams)
    next.delete('github_error')
    setSearchParams(next, { replace: true })
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [returnedError, searchParams, setSearchParams])

  const loadRepos = useCallback(async (g: string) => {
    setPhase({ kind: 'loading' })
    setError(null)
    const res = await listPickableRepos(projectId, g)
    if (!res.ok || !res.data) {
      const code = res.error?.code
      if (code === 'GRANT_EXPIRED' || code === 'GRANT_INVALID' || code === 'GRANT_MISMATCH') {
        forgetGithubGrant(projectId)
        setGrant(null)
      }
      setError({ code, message: githubConnectMessage(code, res.error?.message) })
      setPhase({ kind: 'idle' })
      return
    }
    setPhase({ kind: 'picking', list: res.data })
  }, [projectId])

  // Back from GitHub with a grant: list the repositories straight away.
  useEffect(() => {
    const g = takeGithubGrant(projectId)
    if (!g) return
    setGrant(g)
    void loadRepos(g)
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [projectId, loadRepos])

  const start = async (mode: 'install' | 'authorize') => {
    setPhase({ kind: 'starting' })
    setError(null)
    const res = await requestConnectLinks(projectId, returnTo)
    if (!res.ok || !res.data) {
      setError({ code: res.error?.code, message: githubConnectMessage(res.error?.code, res.error?.message) })
      setPhase({ kind: 'idle' })
      return
    }
    // Same tab: GitHub returns here, and a pop-up blocker cannot eat the step.
    window.location.assign(mode === 'install' ? res.data.installUrl : res.data.authorizeUrl)
  }

  const pick = async (list: RepoList, fullName: string) => {
    if (!grant) return
    setPhase({ kind: 'saving', list, fullName })
    setError(null)
    const res = await saveRepo(projectId, grant, fullName)
    if (!res.ok || !res.data) {
      setError({ code: res.error?.code, message: githubConnectMessage(res.error?.code, res.error?.message) })
      setPhase({ kind: 'picking', list })
      return
    }
    forgetGithubGrant(projectId)
    setGrant(null)
    setPhase({ kind: 'done', repo: res.data })
    onConnected?.(res.data)
  }

  const visible = useMemo(() => {
    if (phase.kind !== 'picking' && phase.kind !== 'saving') return []
    const q = query.trim().toLowerCase()
    return q ? phase.list.repos.filter((r) => r.fullName.toLowerCase().includes(q)) : phase.list.repos
  }, [phase, query])

  const connectedName = phase.kind === 'done' ? phase.repo.fullName : repoFullName(currentRepoUrl ?? loadedRepoUrl)

  return (
    <div ref={cardRef} id="connect-github" className={`scroll-mt-20 ${className}`}>
    <Card className="p-4 space-y-3" data-testid="github-connect-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">Your code on GitHub</h3>
          <p className="mt-0.5 text-xs text-fg-muted">
            Mushi reads the repository to explain bugs and opens each fix as a draft pull request you review.
            You choose which repositories it can see.
          </p>
        </div>
        {connectedName && phase.kind !== 'picking' && phase.kind !== 'saving' && (
          <Badge tone="okSubtle">Connected: {connectedName}</Badge>
        )}
      </div>

      {error && (
        <ErrorAlert
          title="GitHub is not connected yet"
          message={error.message}
          code={error.code}
          onRetry={() => void start('install')}
        />
      )}

      {phase.kind === 'done' && (
        <p className="text-xs text-fg-secondary" role="status">
          Connected <strong>{phase.repo.fullName}</strong> (branch {phase.repo.defaultBranch}). Mushi is reading it now; fixes will open
          as draft pull requests there.
        </p>
      )}

      {(phase.kind === 'idle' || phase.kind === 'starting' || phase.kind === 'done') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Btn
            variant={connectedName ? 'ghost' : 'primary'}
            size="sm"
            loading={phase.kind === 'starting'}
            disabled={phase.kind === 'starting'}
            onClick={() => void start('install')}
          >
            {connectedName ? 'Change repository' : 'Connect GitHub'}
          </Btn>
          {!connectedName && (
            <button
              type="button"
              className="text-2xs text-fg-muted underline underline-offset-2 hover:text-fg"
              onClick={() => void start('authorize')}
              disabled={phase.kind === 'starting'}
            >
              Already installed the Mushi GitHub App? Continue
            </button>
          )}
        </div>
      )}

      {phase.kind === 'loading' && (
        <p className="text-xs text-fg-muted" role="status">Reading the repositories the Mushi GitHub App can see…</p>
      )}

      {(phase.kind === 'picking' || phase.kind === 'saving') && (
        <div className="space-y-2">
          <p className="text-xs text-fg-secondary">
            Signed in to GitHub as <strong>{phase.list.githubLogin || 'you'}</strong>. Pick this app’s repository:
          </p>
          {phase.list.repos.length >= SEARCH_FROM && (
            <Input label="Find a repository" placeholder="owner/name" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          {phase.list.repos.length === 0 ? (
            <div className="rounded-sm border border-edge-subtle p-3 text-xs text-fg-secondary space-y-2">
              <p>The Mushi GitHub App cannot see any repository yet. On GitHub, choose the repositories it may use, then come back.</p>
              <div className="flex flex-wrap gap-2">
                {phase.list.manageUrl && (
                  <a className="text-xs underline underline-offset-2" href={phase.list.manageUrl}>Choose repositories on GitHub</a>
                )}
                {grant && <Btn variant="ghost" size="sm" onClick={() => void loadRepos(grant)}>Refresh the list</Btn>}
              </div>
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-edge-subtle rounded-sm border border-edge-subtle" aria-label="Repositories">
              {visible.map((r) => {
                const current = repoFullName(phase.list.currentRepoUrl) === r.fullName
                const saving = phase.kind === 'saving' && phase.fullName === r.fullName
                return (
                  <li key={`${r.installationId}:${r.fullName}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-fg">{r.fullName}</p>
                      <p className="text-2xs text-fg-muted">
                        {r.private ? 'Private' : 'Public'} · branch {r.defaultBranch}
                        {current ? ' · connected now' : ''}
                      </p>
                    </div>
                    <Btn
                      size="sm"
                      variant={current ? 'ghost' : 'primary'}
                      loading={saving}
                      disabled={phase.kind === 'saving'}
                      onClick={() => void pick(phase.list, r.fullName)}
                    >
                      {current ? 'Keep' : 'Use this'}
                    </Btn>
                  </li>
                )
              })}
              {visible.length === 0 && <li className="px-3 py-2 text-xs text-fg-muted">No repository matches “{query}”.</li>}
            </ul>
          )}
          {phase.list.unreachableInstallations.length > 0 && (
            <p className="text-2xs text-warn">
              One GitHub account’s repositories could not be read right now; they are missing from this list. Refresh in a minute.
            </p>
          )}
          {phase.list.repos.length > 0 && phase.list.manageUrl && (
            <p className="text-2xs text-fg-muted">
              Not in the list? <a className="underline underline-offset-2" href={phase.list.manageUrl}>Let the Mushi GitHub App see more repositories</a>.
            </p>
          )}
        </div>
      )}
    </Card>
    </div>
  )
}
