/**
 * FILE: apps/admin/src/components/ux-runs/UxStartRunCard.tsx
 * PURPOSE: How to start a UX run, in the order the studio asks: what to
 *          improve (the whole app or chosen pages, and a skill), who does the
 *          work (agent, model, the account it spends), how much (screens,
 *          steps, minutes) and the app's dev command. Says plainly what a run
 *          costs and why Mushi shows no credit balance and never switches
 *          accounts on its own (Cursor's usage policy, read 2026-10-07).
 *
 *          It opens with where each step happens. The studio runs on the
 *          developer's own computer (127.0.0.1) and the console cannot reach
 *          it; the run mirrors here and the merge happens here. Owners looked
 *          for the studio inside the console (2026-10-08). Local and cloud
 *          runs are two options of this one card.
 */

import { useState, type ReactNode } from 'react'
import { CodeValue, DisclosurePanel, SegmentedControl } from '../ui'
import { UxCloudRunCard } from './UxCloudRunCard'
import { StatusPill } from '../signal/StatusMark'

const STUDIO_COMMAND = 'mushi ux ui'

const CHOICES: Array<{ title: string; body: string }> = [
  { title: 'What to improve', body: 'The whole app (screens are mapped from the home page) or only pages you pick, plus a skill to focus the agent, such as enhance-mobile-native-feel.' },
  { title: 'Who does the work', body: 'Cursor, Claude Code or Codex, the model, and the account it spends, shown with its plan before you start.' },
  { title: 'How much', body: 'Screens, small steps per screen and minutes per step, with a worst-case time. Each step is measured and kept or rolled back on its own.' },
  { title: 'Your app', body: 'The dev command (the one that worked last time comes first) and the branch to start from. Your checkout is never touched.' },
]

// One 3-step strip (2026-11-18 sweep: seven boxed paragraphs and two
// numbered lists read as a manual). Each step names where it happens.
// Round-2 sweep 2026-11-18: in cloud mode step 1 still said "Run the command
// below" with no command under it. Each mode now has its own first two steps.
export type UxRunWhere = 'local' | 'cloud'
type WhereStep = { where: string; what: ReactNode }

const MERGE_STEP: WhereStep = { where: 'Merge · this page', what: 'Kept changes land on a branch as a draft PR. Merge it here once its checks pass.' }

function uxRunSteps(mode: UxRunWhere): WhereStep[] {
  if (mode === 'cloud') {
    return [
      {
        where: 'Cloud · your repo’s GitHub Actions',
        what: (
          <>
            A Cursor Cloud agent works through your app signed out, one screen at a time. Your repo needs{' '}
            <code className="whitespace-nowrap font-mono">.github/workflows/mushi-ux.yml</code>.{' '}
            {/* Mushi Mushi can't see the file before a run, so the requirement is marked not
                checked rather than left unmarked or faked as found (2026-11-19). */}
            <StatusPill status="idle" label="Not checked" className="align-middle" />
          </>
        ),
      },
      { where: 'Console · this page', what: 'The run shows here once the runner reaches the first screen.' },
      MERGE_STEP,
    ]
  }
  return [
    { where: 'Local studio · this computer', what: 'Run the command below in your app’s repo. An agent edits one screen at a time and a second model checks each change.' },
    { where: 'Console · this page', what: 'Tick Mirror to the Mushi Mushi console and the run shows here as it goes, from any device.' },
    MERGE_STEP,
  ]
}

/** A closed, plain disclosure: one line until asked for (no card inside the card). */
function MoreLine({ summary, children, testId }: { summary: string; children: ReactNode; testId: string }) {
  return (
    <details className="group" data-testid={testId}>
      <summary className="cursor-pointer list-none text-fg-secondary hover:text-fg">
        <span aria-hidden className="mr-1 inline-block text-fg-faint group-open:rotate-90">▸</span>
        {summary}
      </summary>
      <div className="mt-1 pl-4 text-fg-secondary">{children}</div>
    </details>
  )
}

export function UxStartRunCard({ hasRuns, projectId }: { hasRuns: boolean; projectId: string }) {
  const [where, setWhere] = useState<UxRunWhere>('local')
  return (
    <DisclosurePanel title={hasRuns ? 'Start another run' : 'Start your first run'} defaultOpen={!hasRuns}>
      <div className="flex flex-col gap-3 p-3 text-xs">
        <ol className="grid gap-3 sm:grid-cols-3" aria-label="Where each step happens">
          {uxRunSteps(where).map((w, i) => (
            <li key={w.where} className="flex min-w-0 gap-2">
              <span aria-hidden className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-3xs font-semibold tabular-nums text-fg">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-fg">
                  <span className="sr-only">{i + 1}. </span>
                  {w.where}
                </p>
                <p className="mt-0.5 text-fg-secondary">{w.what}</p>
              </div>
            </li>
          ))}
        </ol>
        <SegmentedControl
          ariaLabel="Where the run happens"
          value={where}
          onChange={setWhere}
          className="self-start"
          options={[
            { id: 'local', label: 'On this computer' },
            { id: 'cloud', label: 'In the cloud' },
          ]}
        />
        {where === 'cloud' ? (
          <UxCloudRunCard projectId={projectId} embedded />
        ) : (
        <>
        <CodeValue value={STUDIO_COMMAND} />
        <MoreLine summary="What the studio asks" testId="ux-start-asks">
          <ol className="space-y-1">
            {CHOICES.map((c, i) => (
              <li key={c.title}>
                <span className="font-medium text-fg">
                  {i + 1}. {c.title}
                </span>
                : {c.body}
              </li>
            ))}
          </ol>
        </MoreLine>
        <MoreLine summary="What it costs" testId="ux-start-costs">
          <p>
            A run spends your agent account’s usage at the model’s rate, for example Grok 4.7 at $2 in and $6 out per million tokens ($4 and
            $12 on the Fast tier, the default on Cursor Pro and above). No agent reports how much credit is left, so check your provider’s
            usage page. To use another Cursor account, sign in with it (<code className="font-mono">agent login</code>) before starting the
            studio. If an account runs out, the run stops and can be resumed later; Mushi Mushi never switches accounts for you, because Cursor’s
            usage policy forbids getting around its limits.
          </p>
        </MoreLine>
        </>
        )}
      </div>
    </DisclosurePanel>
  )
}
