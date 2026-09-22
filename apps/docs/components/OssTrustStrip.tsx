/**
 * Open-source trust strip — linked chips (license, self-host, repo, dogfood).
 */
import { MUSHI_OSS } from '@mushi-mushi/brand'
import Link from 'next/link'
import { LANDING_TRUST_LINKS } from '@/lib/landing-copy'

export function OssTrustStrip() {
  return (
    <div className="landing-trust not-prose" aria-label="Open source trust">
      <p className="landing-trust__headline">{MUSHI_OSS.trustStrip}</p>
      <ul className="landing-trust__list">
        {LANDING_TRUST_LINKS.map((item) => {
          const external = item.href.startsWith('http')
          const inner = (
            <>
              <span className="landing-trust__label">{item.label}</span>
              <span className="landing-trust__text">{item.text}</span>
            </>
          )
          return (
            <li key={item.label}>
              {external ? (
                <a
                  className="landing-trust__chip"
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {inner}
                </a>
              ) : (
                /* next/link so the docs basePath is prepended — a raw <a>
                   ships a literal "/security" that only works via the apex
                   redirect function. */
                <Link className="landing-trust__chip" href={item.href}>
                  {inner}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
