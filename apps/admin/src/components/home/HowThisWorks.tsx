/**
 * FILE: apps/admin/src/components/home/HowThisWorks.tsx
 * PURPOSE: What Mushi does with a bug, in four plain steps, behind a small
 *          "How this works" disclosure. Open by default only on a new app
 *          that has no reports yet; everyone else opens it when they want it.
 */

import { Link } from 'react-router-dom'
import { DisclosurePanel } from '../ui'

const STEPS = [
  { title: 'A bug comes in', body: 'A user reports it from your app, or Mushi spots it on your live site or in your monitoring.', to: '/reports', link: 'Bug reports' },
  { title: 'Mushi explains it', body: 'You get a plain-English diagnosis: what broke, where, and how bad it is.', to: '/reports?status=open', link: 'Open bugs' },
  { title: 'An AI agent drafts the fix', body: 'A coding agent opens a pull request; a second model reviews it before anything merges.', to: '/fixes', link: 'Fixes' },
  { title: 'You ship it', body: 'Approved fixes ride a release train to your main branch, and Mushi checks the deploy went live.', to: '/pipeline', link: 'Pipeline' },
] as const

export function HowThisWorks({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <div data-testid="home-how-this-works">
      <DisclosurePanel title="How this works" defaultOpen={defaultOpen}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="min-w-0">
              <p className="text-xs font-semibold text-fg">
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-subtle text-2xs text-brand-foreground">{i + 1}</span>
                {s.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{s.body}</p>
              <Link to={s.to} className="mt-1 inline-block text-2xs text-link hover:underline">
                {s.link} →
              </Link>
            </li>
          ))}
        </ol>
      </DisclosurePanel>
    </div>
  )
}
