/**
 * FILE: apps/admin/src/components/home/WeekCard.tsx
 * PURPOSE: This week against last week for the numbers an owner checks:
 *          bug reports, critical bugs, fixes merged and (with the SDK's
 *          session tracker) user visits. The change is coloured by whether
 *          more is good for that row, and every number links to its list.
 *          Each row also draws its 14 days as tiny columns (2026-11-18,
 *          "pictures instead of sentences"): last week in grey, this week in
 *          ink, so the week's shape reads before the numbers do.
 */

import { Link } from 'react-router-dom'
import { Badge, Section, Skeleton } from '../ui'
import { weekDelta, type HomeSection, type WeekRow } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const DELTA_TONE = { ok: 'okSubtle', warn: 'warnSubtle', neutral: 'neutral' } as const

const BAR_W = 3
const BAR_GAP = 1
/** Extra space between last week and this week. */
const WEEK_GAP = 2
const SPARK_H = 16

/**
 * One row's days as tiny columns on its own scale: last week grey, this week
 * ink, an empty day a 1 px tick so the baseline stays visible. The numbers
 * stay in the table; the aria-label lists every day for screen readers.
 */
function WeekSpark({ label, daily }: { label: string; daily: readonly number[] }) {
  const split = Math.max(0, daily.length - 7)
  const max = Math.max(1, ...daily)
  const width = daily.length * (BAR_W + BAR_GAP) - BAR_GAP + (split > 0 ? WEEK_GAP : 0)
  const aria = `${label} per day, last week: ${daily.slice(0, split).join(', ') || 'none'}; this week: ${daily.slice(split).join(', ')}`
  return (
    <svg role="img" aria-label={aria} viewBox={`0 0 ${width} ${SPARK_H}`} width={width} height={SPARK_H} className="inline-block align-middle" data-testid={`home-week-spark-${label}`}>
      {daily.map((v, i) => {
        const h = v <= 0 ? 1 : Math.max(2, Math.round((v / max) * SPARK_H))
        const x = i * (BAR_W + BAR_GAP) + (i >= split && split > 0 ? WEEK_GAP : 0)
        return <rect key={i} x={x} y={SPARK_H - h} width={BAR_W} height={h} rx={0.5} className={i >= split ? 'fill-fg' : 'fill-fg-faint'} data-week={i >= split ? 'this' : 'last'} />
      })}
    </svg>
  )
}

export function WeekCard({ section }: { section: HomeSection<WeekRow[]> }) {
  return (
    <Section title="This week vs last week" id="home-week">
      <HomeSectionBody section={section} what="this week's numbers" notConnectedText="No numbers yet.">
        {(rows) => (
          <table className="w-full text-sm" data-testid="home-week">
            <thead>
              <tr className="text-left text-2xs text-fg-secondary font-semibold">
                <th scope="col" className="pb-1 font-medium">What</th>
                <th scope="col" className="pb-1 text-right font-medium" title="Each day of the last two weeks: last week grey, this week dark">
                  14 days
                </th>
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
                    <td className="py-1.5 pr-2 text-right">{r.daily && r.daily.length > 1 ? <WeekSpark label={r.label} daily={r.daily} /> : null}</td>
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
