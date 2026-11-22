/**
 * How one bug moves through Mushi Mushi, as a timeline: who acts at each
 * station, what happens, and a link to the walkthrough that shows it. A dot
 * runs down the line to show the order; it stays still with reduced motion.
 *
 * Each station's claim matches a shipped behaviour (AGENTS.md agent
 * inventory, ADR 0044 release trains, `finalizeFixMerge` reporter notice).
 */

import Link from 'next/link'

interface Station {
  actor: string
  title: string
  detail: string
  see?: { href: string; label: string }
}

const STATIONS: Station[] = [
  {
    actor: 'Your user, Sentry, or a check',
    title: 'A bug comes in',
    detail:
      'From the report button in your app, an error in Sentry, or a check Mushi Mushi runs on its own: a first-time user test, a watch on your live site, a scan for known security holes.',
    see: { href: '#report-a-bug', label: 'Watch a user report one' },
  },
  {
    actor: 'Mushi Mushi',
    title: 'It is explained in plain English',
    detail:
      'Duplicates are merged. Mushi Mushi reads the screenshot, the page and your code, then writes why it broke, how to fix it and how to see it happen.',
    see: { href: '#bug-to-fix', label: 'Watch a real diagnosis' },
  },
  {
    actor: 'You and your AI editor',
    title: 'You choose who fixes it',
    detail:
      'Paste the fix prompt into Cursor, Claude Code or Lovable, let your editor fetch the bug over MCP, or send it to a fix agent that opens a pull request.',
    see: { href: '#connect-editor', label: 'Watch the editor setup' },
  },
  {
    actor: 'CI and a second AI',
    title: 'The fix is checked',
    detail: 'Your CI runs. A second AI reads the pull request next to the original report and can refuse it.',
  },
  {
    actor: 'Release train',
    title: 'Approved fixes ship together',
    detail:
      'With “Merge when ready” on, approved fixes leave together: one branch, one CI run, one merge and one deploy. Anything stuck says why.',
    see: { href: '#ship-fixes', label: 'Watch the pipeline' },
  },
  {
    actor: 'Mushi Mushi',
    title: 'The reporter hears back',
    detail: 'The bug is marked fixed, and the person who reported it is told.',
  },
]

export function HowItWorksFlow() {
  return (
    <div className="docs-flow not-prose" role="group" aria-label="How a bug moves through Mushi Mushi, in six steps">
      <ol className="docs-flow__list">
        {STATIONS.map((s, i) => (
          <li key={s.title} className="docs-flow__station" style={{ ['--i' as string]: i }}>
            <span className="docs-flow__node" aria-hidden="true">
              {i + 1}
            </span>
            <div className="docs-flow__card">
              <span className="docs-flow__actor">{s.actor}</span>
              <span className="docs-flow__title">{s.title}</span>
              <span className="docs-flow__detail">{s.detail}</span>
              {s.see ? (
                <Link className="docs-flow__see" href={s.see.href}>
                  {s.see.label} ↓
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <span className="docs-flow__packet" aria-hidden="true" />
    </div>
  )
}
