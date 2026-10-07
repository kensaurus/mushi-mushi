/**
 * FILE: apps/admin/src/components/ux-runs/UxStartRunCard.tsx
 * PURPOSE: How to start a UX run, in the order the studio asks: what to
 *          improve (the whole app or chosen pages, and a skill), who does the
 *          work (agent, model, the account it spends), how much (screens,
 *          steps, minutes) and the app's dev command. Says plainly what a run
 *          costs and why Mushi shows no credit balance and never switches
 *          accounts on its own (Cursor's usage policy, read 2026-10-07).
 */

import { CodeValue, DisclosurePanel } from '../ui'

const STUDIO_COMMAND = 'mushi ux ui'

const CHOICES: Array<{ title: string; body: string }> = [
  { title: 'What to improve', body: 'The whole app (screens are mapped from the home page) or only pages you pick, plus a skill to focus the agent, such as enhance-mobile-native-feel.' },
  { title: 'Who does the work', body: 'Cursor, Claude Code or Codex, the model, and the account it spends, shown with its plan before you start.' },
  { title: 'How much', body: 'Screens, small steps per screen and minutes per step, with a worst-case time. Each step is measured and kept or rolled back on its own.' },
  { title: 'Your app', body: 'The dev command (the one that worked last time comes first) and the branch to start from. Your checkout is never touched.' },
]

export function UxStartRunCard({ hasRuns }: { hasRuns: boolean }) {
  return (
    <DisclosurePanel title={hasRuns ? 'Start another run' : 'Start your first run'} defaultOpen={!hasRuns}>
      <div className="flex flex-col gap-3 p-3 text-xs">
        <div className="flex flex-col gap-1">
          <p className="text-fg-secondary">In your app’s repo, open the studio. It runs on your machine with your own agent sign-in:</p>
          <CodeValue value={STUDIO_COMMAND} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {CHOICES.map((c, i) => (
            <li key={c.title} className="rounded-md border border-edge-subtle p-2">
              <p className="font-medium text-fg">
                {i + 1}. {c.title}
              </p>
              <p className="mt-0.5 text-fg-secondary">{c.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-fg-secondary">
          Tick <span className="font-medium">Mirror to the Mushi console</span> and the run shows here as it goes. Kept changes land on a
          branch; you open the draft PR.
        </p>
        <div className="rounded-md bg-surface-overlay p-2 text-fg-secondary">
          <p className="font-medium text-fg">What it costs</p>
          <p className="mt-0.5">
            A run spends your agent account’s usage at the model’s rate, for example Grok 4.7 at $2 in and $6 out per million tokens ($4 and
            $12 on the Fast tier, the default on Cursor Pro and above). No agent reports how much credit is left, so check your provider’s
            usage page. To use another Cursor account, sign in with it (<code className="font-mono">agent login</code>) before starting the
            studio. If an account runs out, the run stops and can be resumed later; Mushi never switches accounts for you, because Cursor’s
            usage policy forbids getting around its limits.
          </p>
        </div>
      </div>
    </DisclosurePanel>
  )
}
