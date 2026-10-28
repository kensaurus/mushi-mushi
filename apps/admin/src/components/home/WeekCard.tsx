/**
 * FILE: apps/admin/src/components/home/WeekCard.tsx
 * PURPOSE: This week against last week for the numbers an owner checks:
 *          bug reports, critical bugs, fixes merged and (with the SDK's
 *          session tracker) user visits. The change is coloured by whether
 *          more is good for that row, and every number links to its list.
 */

import { Link } from 'react-router-dom'
import { Badge, Section, Skeleton } from '../ui'
import { weekDelta, type HomeSection, type WeekRow } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const DELTA_TONE = { ok: 'okSubtle', warn: 'warnSubtle', neutral: 'neutral' } as const

export function WeekCard({ section }: { section: HomeSection<WeekRow[]> }) {
  return (
    <Section title="This week vs last week" id="home-week">
      <HomeSectionBody section={section} what="this week's numbers" notConnectedText="No numbers yet.">
        {(rows) => rows.length === 0 ? (
          <p className="text-sm text-fg-muted">No numbers for this week yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="home-week">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-fg-muted">
                <th scope="col" className="pb-1 font-medium">What</th>
                <th scope="col" className="pb-1 text-right font-medium">This week</th>
                <th scope="col" className="pb-1 text-right font-medium">Last week</th>
                <th scope="col" className="pb-1 text-right font-medium">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {rows.map((r) => {
                const d = weekDelta(r)
                return (
                  <tr key={r.id}>
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-fg-secondary">{r.label}</th>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-fg">
                      <Link to={r.href} className="hover:underline">{r.thisWeek}</Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-fg-muted">{r.lastWeek}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <Badge tone={DELTA_TONE[d.tone]}>{d.text}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </HomeSectionBody>
    </Section>
  )
}

export function WeekSkeleton() {
  return (
    <Section title="This week vs last week">
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </Section>
  )
}
