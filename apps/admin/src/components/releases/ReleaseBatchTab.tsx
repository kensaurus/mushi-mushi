/**
 * FILE: apps/admin/src/components/releases/ReleaseBatchTab.tsx
 * PURPOSE: The /releases "Batch" tab (console ops plan 2026-10-27, P1): for
 *          each repo, the release train running now or leaving next
 *          (ADR 0044). Each member shows Opus's verdict and CI at its current
 *          commit and why it rides or waits; then the rules every member
 *          must pass, the migration files in the batch (Mushi lists them and
 *          never runs them), and whether a deploy was seen after the last
 *          train merged. Read-only: reruns and merges stay on /pipeline.
 *
 *          Reads GET /v1/admin/release-batch for the active app, or every
 *          app when none is picked.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import {
  batchSentence,
  CI_WORDS,
  DEPLOY_WORDS,
  PARTIAL_WORDS,
  trainPrUrl,
  verdictWords,
  type BatchMember,
  type ReleaseBatchResponse,
  type RepoBatch,
} from '../../lib/releaseBatch'
import { CHIP_TONE, LINK_ACCENT } from '../../lib/chipTone'
import { Badge, Card, ErrorAlert, HelpPopover, Loading, PageFirstStep, PageStatus, RelativeTime } from '../ui'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const TONE_CHIP: Record<Tone, string> = {
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
  info: CHIP_TONE.infoSubtle,
  neutral: CHIP_TONE.neutral,
}

function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <Badge className={`${TONE_CHIP[tone]} whitespace-nowrap`}>{children}</Badge>
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT}>
      {children}
    </a>
  )
}

function MemberLine({ m }: { m: BatchMember }) {
  const verdict = verdictWords(m)
  const ci = CI_WORDS[m.ci]
  const showQueue = m.queueDetail && m.queueDetail !== m.why
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2.5" data-testid={`batch-member-${m.prNumber}`} data-rides={m.rides ? 'yes' : 'no'}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {m.prUrl ? <ExternalLink href={m.prUrl}>{`#${m.prNumber}`}</ExternalLink> : <span className="text-sm text-fg">#{m.prNumber}</span>}
        <span className="min-w-0 flex-1 basis-48 text-sm text-fg break-words">{m.title ?? 'Untitled fix'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {m.express && !m.rides ? null : <Chip tone={m.rides ? 'ok' : 'neutral'}>{m.rides ? 'Rides' : 'Waits'}</Chip>}
        <Chip tone={verdict.tone}>{verdict.label}</Chip>
        <Chip tone={ci.tone}>{ci.label}</Chip>
        {m.draft ? <Chip tone="neutral">Draft</Chip> : null}
        {m.express ? <Chip tone="info">Urgent: merges alone</Chip> : null}
      </div>
      <p className="text-xs leading-relaxed text-fg-muted break-words text-pretty">{m.why}</p>
      {showQueue ? <p className="text-2xs text-fg-faint break-words">Merge queue: {m.queueDetail}</p> : null}
    </li>
  )
}

function TrainLine({ b }: { b: RepoBatch }) {
  const t = b.train
  if (b.mode === 'each') {
    return (
      <p className="text-xs text-fg-muted">
        This app merges each fix on its own (release mode &ldquo;each&rdquo;), so there is no train. Change it in the{' '}
        <Link to="/fixes" className={LINK_ACCENT}>
          merge queue on Fixes
        </Link>
        .
      </p>
    )
  }
  if (t.kind === 'open') {
    const url = trainPrUrl(b.repo, t.prNumber)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-secondary">
        <span>Train {url ? <ExternalLink href={url}>{`#${t.prNumber}`}</ExternalLink> : null}</span>
        <span>is {t.state === 'building' ? 'being built' : 'running CI'} with {t.readyCount} fix{t.readyCount === 1 ? '' : 'es'}</span>
        {t.attempt > 1 ? <span>(retry {t.attempt})</span> : null}
        <Chip tone={CI_WORDS[t.ci].tone}>{CI_WORDS[t.ci].label}</Chip>
        {t.detail ? <span className="basis-full text-fg-muted break-words">{t.detail}</span> : null}
      </div>
    )
  }
  return (
    <p className="text-xs text-fg-secondary">
      {t.readyCount === 0 ? (
        'Next train: nothing is ready yet.'
      ) : t.leavesAt ? (
        <>
          Next train: {t.readyCount} fix{t.readyCount === 1 ? '' : 'es'} ready; it leaves <RelativeTime value={t.leavesAt} /> (every {Math.round(t.intervalMinutes / 60)} h, or at once when {t.maxMembers} are ready).
        </>
      ) : (
        `Next train: ${t.readyCount} ready.`
      )}
    </p>
  )
}

function Gates({ b }: { b: RepoBatch }) {
  if (b.mode === 'each' || b.members.length === 0) return null
  return (
    <div data-testid="batch-gates">
      <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Rules to ride</h4>
      <ul className="mt-1 space-y-0.5">
        {b.gates.map((g) => (
          <li key={g.id} className="flex items-baseline gap-2 text-xs">
            <span className={`shrink-0 tabular-nums font-medium ${g.passed === g.total ? 'text-ok' : 'text-warn'}`}>
              {g.passed}/{g.total}
            </span>
            <span className="min-w-0 text-fg-secondary break-words">{g.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Migrations({ b }: { b: RepoBatch }) {
  const m = b.migrations
  if (b.members.length === 0) return null
  const where = m.source === 'recipe' ? `the recipe's folder (${m.globs.join(', ')})` : m.globs.join(', ')
  return (
    <div data-testid="batch-migrations">
      <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Database migrations</h4>
      {m.files.length > 0 ? (
        <div className={`mt-1 rounded-sm px-2.5 py-2 ${CHIP_TONE.warnSubtle}`}>
          <p className="text-xs">
            This batch changes the database: {m.files.length} migration file{m.files.length === 1 ? '' : 's'}. Mushi does not run them; apply them when you deploy.
          </p>
          <ul className="mt-1 space-y-0.5">
            {m.files.map((f) => (
              <li key={`${f.prNumber}:${f.path}`} className="min-w-0 break-all font-mono text-2xs">
                #{f.prNumber} {f.path}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1 text-xs text-fg-muted">{m.complete ? `No migration files in these changes (looked in ${where}).` : `None found so far (looked in ${where}).`}</p>
      )}
      {!m.complete ? (
        <p className="mt-1 text-2xs text-warn-foreground">
          {m.unread.length ? `Mushi could not read the changes of ${m.unread.map((n) => `#${n}`).join(', ')}, so this list may be incomplete.` : 'A change was too large to read in full, so this list may be incomplete.'}
        </p>
      ) : null}
    </div>
  )
}

function Deploy({ b }: { b: RepoBatch }) {
  const d = b.deploy
  return (
    <div data-testid="batch-deploy">
      <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Deploy after the last train</h4>
      <p className="mt-1 text-xs text-fg-secondary">
        {d.train ? (
          <>
            Train {d.train.prNumber ? `#${d.train.prNumber}` : ''} merged <RelativeTime value={d.train.mergedAt} />. {DEPLOY_WORDS[d.state]}
            {d.seenAt ? (
              <>
                {' '}
                Seen <RelativeTime value={d.seenAt} />
                {d.version ? `, version ${d.version}` : ''}.
              </>
            ) : null}
          </>
        ) : (
          DEPLOY_WORDS[d.state]
        )}
      </p>
      {d.setupGapHref ? (
        <p className="mt-1 text-2xs text-warn-foreground">
          Mushi has seen no deploy of this app in 14 days, so reporters are not told when their fix is live.{' '}
          <Link to={d.setupGapHref} className={LINK_ACCENT}>
            See the setup gap
          </Link>
        </p>
      ) : null}
    </div>
  )
}

function RepoCard({ b, showApp }: { b: RepoBatch; showApp: boolean }) {
  return (
    <Card className="p-3 sm:p-4" data-testid={`batch-repo-${b.repo}`}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 break-all font-mono text-sm font-semibold text-fg">{b.repo}</h3>
        {showApp ? <span className="text-2xs text-fg-muted">{b.projectName}</span> : null}
      </div>
      <div className="mt-1.5">
        <TrainLine b={b} />
      </div>
      {b.members.length ? (
        <ul className="mt-2 divide-y divide-edge-subtle" aria-label={`Fixes in ${b.repo}`}>
          {b.members.map((m) => (
            <MemberLine key={m.fixAttemptId} m={m} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">No fix is queued to merge in this repo.</p>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Gates b={b} />
        <Migrations b={b} />
        <Deploy b={b} />
      </div>
    </Card>
  )
}

export function ReleaseBatchTab({ projectId }: { projectId: string | null }) {
  const path = projectId ? `/v1/admin/release-batch?projectId=${encodeURIComponent(projectId)}` : '/v1/admin/release-batch'
  const page = usePageData<ReleaseBatchResponse>(path, { scope: projectId ? 'project' : 'enumeration' })
  if (page.loading && !page.data) return <Loading text="Reading the release trains…" />
  if (page.error && !page.data) return <ErrorAlert title="Release batch" message={page.error} onRetry={page.reload} />
  const repos = page.data?.repos ?? []
  const partial = page.data?.partial ?? []
  const status = batchSentence(repos)
  const showApp = new Set(repos.map((r) => r.projectId)).size > 1

  if (repos.length === 0) {
    return (
      <PageFirstStep
        title="No repo to batch yet"
        sentence="Release trains collect your approved fix pull requests and merge them together, once per repo. Connect GitHub so Mushi can open fixes."
        action={{ label: 'Connect GitHub', to: '/connect#connect-github' }}
        marksPageEmpty={false}
        data-testid="batch-empty"
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="release-batch">
      <PageStatus
        sentence={status.sentence}
        tone={status.tone}
        ariaLabel="Release batch status"
        data-testid="batch-status"
        freshness={{ at: page.data?.generatedAt ?? null, isValidating: page.isValidating }}
        action={
          <HelpPopover label="How trains work" title="How release trains work" align="end">
            <p className="text-xs text-fg-secondary">
              Approved fix pull requests ride one train per repo: one branch, one CI run, one merge and one deploy. A fix rides when Opus said merge at its current commit, it is not a draft, its own CI is green, and it did not keep failing trains at that commit. Urgent fixes merge alone.
            </p>
            <p className="mt-2 text-xs text-fg-muted">This tab only reads. Re-run, merge and remove from /pipeline.</p>
          </HelpPopover>
        }
      />
      {partial.length ? (
        <p className="text-2xs text-warn-foreground" data-testid="batch-partial">
          Mushi could not read {partial.map((p) => PARTIAL_WORDS[p] ?? p).join(', ')}; what depends on it may be incomplete.
        </p>
      ) : null}
      {repos.map((b) => (
        <RepoCard key={`${b.projectId}|${b.repo}`} b={b} showApp={showApp} />
      ))}
    </div>
  )
}
