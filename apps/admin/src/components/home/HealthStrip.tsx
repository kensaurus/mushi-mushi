/**
 * FILE: apps/admin/src/components/home/HealthStrip.tsx
 * PURPOSE: Four traffic lights for the app: is the site up, is it
 *          erroring, is the SDK sending, is CI on main green. Each light has
 *          a word beside its colour and links to where its number came from;
 *          one that is not connected says how to connect it.
 */

import { Link } from 'react-router-dom'
import { Btn, Card, PanelHeader, RelativeTime, Skeleton } from '../ui'
import { LIGHT_DOT, LIGHT_WORD, type HealthSignal, type HomeSection } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

export function HealthStrip({ section }: { section: HomeSection<HealthSignal[]> }) {
  return (
    <section aria-label="App health" data-testid="home-health" className="min-w-0">
      <HomeSectionBody section={section} what="the app's health" notConnectedText="No health signals yet.">
        {(signals) =>
          signals.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing to show for the app&apos;s health yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              {signals.map((s) => (
                <li key={s.id}>
                  <HealthTile signal={s} />
                </li>
              ))}
            </ul>
          )
        }
      </HomeSectionBody>
    </section>
  )
}

function HealthTile({ signal: s }: { signal: HealthSignal }) {
  return (
    <Card className="flex h-full min-w-0 flex-col gap-1 p-3" data-testid={`home-health-${s.id}`}>
      <PanelHeader
        className="mb-1"
        title={
          <Link to={s.href} className="hover:text-fg">
            {s.label}
          </Link>
        }
        action={
          <span className="inline-flex items-center gap-1.5 text-2xs text-fg-secondary">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${LIGHT_DOT[s.light]}`} />
            <span>{s.status === 'error' ? 'Unknown' : LIGHT_WORD[s.light]}</span>
          </span>
        }
      />
      <Link to={s.href} className="text-base font-semibold leading-tight text-fg hover:underline">
        {s.headline}
      </Link>
      {s.detail && <p className="line-clamp-2 text-xs leading-snug text-fg-muted">{s.detail}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        {s.at ? (
          <span className="text-2xs text-fg-faint">
            <RelativeTime value={s.at} />
          </span>
        ) : (
          <span />
        )}
        {s.connect && (
          <Btn size="sm" variant="ghost" to={s.connect.to}>
            {s.connect.label}
          </Btn>
        )}
      </div>
    </Card>
  )
}

export function HealthStripSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="space-y-2 p-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </Card>
      ))}
    </div>
  )
}
