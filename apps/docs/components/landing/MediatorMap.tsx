/**
 * The mediator map — where bugs come in, the one queue, where fixes go out
 * (VISION.md §1.5). Every row is a link to the page that documents it, so the
 * map cannot claim an integration the docs do not describe.
 */
import Link from 'next/link'
import { LANDING_MEDIATOR, type LandingMediatorLink } from '@/lib/landing-copy'

function Column({ title, items }: { title: string; items: readonly LandingMediatorLink[] }) {
  return (
    <div className="landing-mediator__col">
      <h3 className="landing-mediator__heading">{title}</h3>
      <ul className="landing-mediator__list">
        {items.map((item) => (
          <li key={item.label}>
            <Link className="landing-mediator__link" href={item.href}>
              <span className="landing-mediator__label">{item.label}</span>
              <span className="landing-mediator__detail">{item.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MediatorMap() {
  return (
    <div className="landing-mediator not-prose">
      <div className="landing-mediator__grid">
        <Column title="Bugs come in from" items={LANDING_MEDIATOR.inbound} />
        <div className="landing-mediator__core" aria-label="The Mushi queue">
          <span className="landing-mediator__stamp" aria-hidden="true">
            虫
          </span>
          <p>{LANDING_MEDIATOR.core}</p>
        </div>
        <Column title="Fixes and status go out to" items={LANDING_MEDIATOR.outbound} />
      </div>
      <p className="landing-mediator__gating">{LANDING_MEDIATOR.gating}</p>
    </div>
  )
}
