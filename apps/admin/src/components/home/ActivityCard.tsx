/**
 * FILE: apps/admin/src/components/home/ActivityCard.tsx
 * PURPOSE: What happened on the app lately, grouped into plain sentences
 *          ("3 fixes merged today"), each linking to the list behind it,
 *          instead of one row per event.
 */

import { Link } from 'react-router-dom'
import { Section, Skeleton } from '../ui'
import type { ActivityLine, HomeSection } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

export function ActivityCard({ section }: { section: HomeSection<ActivityLine[]> }) {
  return (
    <Section title="Recent activity" id="home-activity">
      <HomeSectionBody section={section} what="recent activity" notConnectedText="Nothing has happened yet.">
        {(lines) =>
          lines.length === 0 ? (
            <p className="text-sm text-fg-muted">A quiet week: nothing reported, merged or deployed.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="home-activity">
              {lines.map((l) => (
                <li key={l.id}>
                  <Link to={l.to} className="text-sm text-fg hover:underline">
                    {l.text}
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </HomeSectionBody>
    </Section>
  )
}

export function ActivitySkeleton() {
  return (
    <Section title="Recent activity">
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </Section>
  )
}
