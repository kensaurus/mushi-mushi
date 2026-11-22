/**
 * FILE: apps/admin/src/components/home/HealthStrip.tsx
 * PURPOSE: Four traffic lights for the app: is the site up, is it
 *          erroring, is the SDK sending, is CI on main green. Each light has
 *          a word beside its colour and links to where its number came from;
 *          one that is not connected says how to connect it.
 */

import { Link } from 'react-router-dom'
import { Btn, Card, PanelHeader, RelativeTime, Skeleton } from '../ui'
import { LIGHT_WORD, type HealthSignal, type HomeSection } from '../../lib/projectHome'
import { StatusGlyph, TONE_INK } from '../signal/StatusGlyph'
import { healthDisplayTone } from '../../lib/homeView'
import { HomeSectionBody } from './HomeSectionBody'
import { homeConnectHref } from '../../lib/homeConnectHref'

export function HealthStrip({ section }: { section: HomeSection<HealthSignal[]> }) {
  return (
    <section aria-label="App health" data-testid="home-health" className="min-w-0">
      <HomeSectionBody section={section} what="the app's health" notConnectedText="No health signals yet.">
        {(signals) => (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
            {signals.map((s) => (
              <li key={s.id}>
                <HealthTile signal={s} />
              </li>
            ))}
          </ul>
        )}
      </HomeSectionBody>
    </section>
  )
}

/**
 * The lights in a builder's words (console audit 2026-11-11): the server
 * names them "SDK sending" and "CI", and its connect buttons "Install the
 * SDK" / "Set up the SDK". Unknown ids keep the server's words.
 */
const PLAIN_LABEL: Record<string, string> = {
  site: 'Is my site up?',
  errors: 'Bugs today',
  sdk: 'Report button working',
  ci: 'Tests on your code',
}
const PLAIN_CONNECT: Record<string, string> = {
  'Install the SDK': 'Add the report button',
  'Set up the SDK': 'Add the report button',
}

/**
 * @internal Exported for tests.
 * The detail line only when it adds something the mark does not: a problem
 * to read. "Passing / 4 checks green on the latest commit" said one state
 * twice (fresh-eyes sweep 2026-11-18); a good or unconnected light keeps the
 * mark and the number, with the sentence as a tooltip.
 */
export function showHealthDetail(s: Pick<HealthSignal, 'light' | 'detail'>): boolean {
  return !!s.detail && (s.light === 'bad' || s.light === 'warn')
}

function HealthTile({ signal: server }: { signal: HealthSignal }) {
  const s: HealthSignal = {
    ...server,
    label: PLAIN_LABEL[server.id] ?? server.label,
    ...(server.connect ? { connect: { ...server.connect, label: PLAIN_CONNECT[server.connect.label] ?? server.connect.label } } : {}),
  }
  const tone = healthDisplayTone(s)
  return (
    <Card className="flex h-full min-w-0 flex-col gap-1 p-3" data-testid={`home-health-${s.id}`}>
      <PanelHeader
        className="mb-1"
        title={
          <Link to={s.href} className="hover:text-fg">
            {s.label}
          </Link>
        }
      />
      {/* The state is the value's mark and colour: a "Good" pill beside
          "Passing" said it twice (round-2 sweep 2026-11-18). The word stays
          for screen readers on the mark. */}
      <Link
        to={s.href}
        className={`inline-flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight hover:underline ${TONE_INK[tone]}`}
        title={s.detail ?? undefined}
        data-tone={tone}
      >
        <StatusGlyph tone={tone} label={s.status === 'error' ? 'Unknown' : LIGHT_WORD[s.light]} />
        <span className="min-w-0">{s.headline}</span>
      </Link>
      {showHealthDetail(s) && <p className="line-clamp-2 text-xs leading-snug text-fg-muted">{s.detail}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        {s.at ? (
          <span className="text-2xs text-fg-faint">
            <RelativeTime value={s.at} />
          </span>
        ) : (
          <span />
        )}
        {s.connect && (
          <Btn size="sm" variant="ghost" to={homeConnectHref(s.connect)}>
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
