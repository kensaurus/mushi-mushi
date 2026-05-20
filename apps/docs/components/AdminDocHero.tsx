/**
 * Auto-resolves the showcase asset for an admin docs page from admin-screenshots.ts.
 * Usage in MDX: <AdminDocHero page="dashboard" />
 */

import { DocScreenshot } from './DocScreenshot'
import { ADMIN_DEMO_BASE, ADMIN_SCREENSHOTS } from '../data/admin-screenshots'

export interface AdminDocHeroProps {
  page: string
  /** Prefer per-page GIF when available (default true). */
  preferGif?: boolean
  /** Also show static PNG below the GIF (default false). */
  showStatic?: boolean
}

export function AdminDocHero({
  page,
  preferGif = true,
  showStatic = false,
}: AdminDocHeroProps) {
  const entry = ADMIN_SCREENSHOTS[page]
  if (!entry) return null

  const demoHref = `${ADMIN_DEMO_BASE}${entry.route}`
  const gifSrc = entry.gif ?? `${page}-demo.gif`

  if (preferGif) {
    return (
      <>
        <DocScreenshot
          src={gifSrc}
          alt={entry.alt}
          caption={<strong>{entry.caption}</strong>}
          href={demoHref}
          animated
          variant="preview"
          expandable
        />
        {showStatic ? (
          <DocScreenshot
            src={entry.image}
            lightSrc={entry.light}
            alt={entry.alt}
            caption="Static view"
            href={demoHref}
            variant="preview"
            expandable
          />
        ) : null}
      </>
    )
  }

  return (
    <DocScreenshot
      src={entry.image}
      lightSrc={entry.light}
      alt={entry.alt}
      caption={<strong>{entry.caption}</strong>}
      href={demoHref}
      variant="preview"
      expandable
    />
  )
}
