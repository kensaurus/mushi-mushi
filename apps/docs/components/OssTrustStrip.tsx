/**
 * Open-source trust strip — linked chips (license, self-host, repo, dogfood).
 */
import { MUSHI_OSS } from '@mushi-mushi/brand'
import { LANDING_TRUST_LINKS } from '@/lib/landing-copy'

export function OssTrustStrip() {
  return (
    <div className="landing-trust not-prose" aria-label="Open source trust">
      <p className="landing-trust__headline">{MUSHI_OSS.trustStrip}</p>
      <ul className="landing-trust__list">
        {LANDING_TRUST_LINKS.map((item) => {
          const external = item.href.startsWith('http')
          return (
            <li key={item.label}>
              <a
                className="landing-trust__chip"
                href={item.href}
                {...(external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                <span className="landing-trust__label">{item.label}</span>
                <span className="landing-trust__text">{item.text}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
