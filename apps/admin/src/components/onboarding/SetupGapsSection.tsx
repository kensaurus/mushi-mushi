/**
 * FILE: apps/admin/src/components/onboarding/SetupGapsSection.tsx
 * PURPOSE: "Setup gaps" on the Set up page (console ops plan 2026-10-27,
 *          P1): the owner configuration that is missing for the active app,
 *          found before a button fails with a 403. One line per check, gaps
 *          first, each with a Fix link; checks that pass fold into one line.
 *          Reads GET /v1/admin/setup-gaps (cached 10 minutes on the server;
 *          "Check again" re-checks). Read-only.
 *
 *          Anchor: #setup-gaps (the release batch links here when no deploy
 *          was seen in 14 days).
 */

import { useState } from 'react'
import { usePageData } from '../../lib/usePageData'
import { isConsolePath, setupGapsSentence, type SetupGap, type SetupGapsResponse } from '../../lib/setupGaps'
import { Btn, ErrorAlert, HelpPopover, Loading, PageStatus, Section } from '../ui'

const DOT: Record<SetupGap['status'], string> = {
  gap: 'bg-danger',
  unknown: 'bg-warn',
  ok: 'bg-ok',
}

const STATUS_WORD: Record<SetupGap['status'], string> = {
  gap: 'To fix',
  unknown: 'Not checked',
  ok: 'Fine',
}

function FixLink({ gap }: { gap: SetupGap }) {
  const label = gap.status === 'gap' ? 'Fix' : 'Open'
  return isConsolePath(gap.fixHref) ? (
    <Btn size="sm" variant={gap.status === 'gap' ? 'primary' : 'ghost'} to={gap.fixHref} aria-label={`${label}: ${gap.title}`}>
      {label}
    </Btn>
  ) : (
    <Btn size="sm" variant="ghost" href={gap.fixHref} aria-label={`${label}: ${gap.title}`}>
      {label}
    </Btn>
  )
}

function GapLine({ gap }: { gap: SetupGap }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between" data-testid={`setup-gap-${gap.id}`} data-status={gap.status}>
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[gap.status]}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg break-words">
            <span className="sr-only">{STATUS_WORD[gap.status]}: </span>
            {gap.title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted break-words text-pretty">{gap.summary}</p>
        </div>
      </div>
      {gap.status !== 'ok' ? (
        <div className="shrink-0 pl-4 sm:pl-0">
          <FixLink gap={gap} />
        </div>
      ) : null}
    </li>
  )
}

export function SetupGapsSection({ projectId }: { projectId: string | null }) {
  const [refresh, setRefresh] = useState(false)
  const path = projectId ? `/v1/admin/setup-gaps?projectId=${encodeURIComponent(projectId)}${refresh ? '&refresh=1' : ''}` : null
  const page = usePageData<SetupGapsResponse>(path)
  if (!projectId) return null

  const project = page.data?.projects.find((p) => p.projectId === projectId) ?? page.data?.projects[0] ?? null
  const gaps = project?.gaps ?? []
  const open = gaps.filter((g) => g.status !== 'ok')
  const fine = gaps.filter((g) => g.status === 'ok')
  const status = setupGapsSentence(gaps)

  const help = (
    <HelpPopover label="What is checked" title="What Mushi checks" align="end">
      <ul className="list-disc space-y-1 pl-4 text-xs text-fg-secondary">
        <li>What Mushi&apos;s GitHub access can do in each repo: push fix branches, open pull requests, re-run CI, write CI secrets.</li>
        <li>Whether the review follow-up key and the auto-fix Cursor keys still work.</li>
        <li>Whether a deploy was seen in the last 14 days, so reporters hear when their fix is live.</li>
        <li>Whether Slack still accepts the bot token.</li>
      </ul>
      <p className="mt-2 text-xs text-fg-muted">Mushi only reads to check. It never writes to GitHub to find out whether it may write, so some lines say &ldquo;can&apos;t tell&rdquo;.</p>
    </HelpPopover>
  )

  return (
    <Section
      id="setup-gaps"
      title="Setup gaps"
      freshness={project ? { at: project.checkedAt, isValidating: page.isValidating } : undefined}
      action={
        <span className="flex items-center gap-2">
          {help}
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => (refresh ? page.reload() : setRefresh(true))}
            loading={page.isValidating}
            disabled={page.loading}
          >
            Check again
          </Btn>
        </span>
      }
    >
      <div data-testid="setup-gaps" className="flex flex-col gap-2">
        {page.loading && !page.data ? (
          <Loading text="Checking your setup…" />
        ) : page.error && !page.data ? (
          <ErrorAlert title="Setup gaps" message={page.error} onRetry={page.reload} />
        ) : (
          <>
            <PageStatus sentence={status.sentence} tone={status.tone} ariaLabel="Setup gaps status" data-testid="setup-gaps-status" />
            {open.length > 0 ? (
              <ul className="divide-y divide-edge-subtle" data-testid="setup-gaps-open">
                {open.map((g) => (
                  <GapLine key={g.id} gap={g} />
                ))}
              </ul>
            ) : null}
            {fine.length > 0 ? (
              <details className="group rounded-sm" data-testid="setup-gaps-fine">
                <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                  {fine.length} check{fine.length === 1 ? '' : 's'} pass
                </summary>
                <ul className="divide-y divide-edge-subtle">
                  {fine.map((g) => (
                    <GapLine key={g.id} gap={g} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </Section>
  )
}
