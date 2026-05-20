/**
 * Auto-resolves the showcase asset for an admin docs page from admin-screenshots.ts.
 * Usage in MDX: <AdminDocHero page="dashboard" />
 */

import { DocScreenshot } from './DocScreenshot'
import { ADMIN_DEMO_BASE, ADMIN_SCREENSHOTS } from '../data/admin-screenshots'

export interface AdminDocHeroProps {
  page: string
  /** Prefer GIF over static PNG when both exist. */
  preferGif?: boolean
  /** Show static PNG even when a GIF exists (below the GIF). */
  showStatic?: boolean
}

export function AdminDocHero({ page, preferGif = false, showStatic = true }: AdminDocHeroProps) {
  const entry = ADMIN_SCREENSHOTS[page]
  if (!entry) return null

  const demoHref = `${ADMIN_DEMO_BASE}${entry.route}`

  if (preferGif && entry.gif) {
    return (
      <>
        <DocScreenshot
          src={entry.gif}
          alt={entry.alt}
          caption={<><strong>{entry.caption}</strong></>}
          href={demoHref}
          animated
        />
        {showStatic ? (
          <DocScreenshot
            src={entry.image}
            lightSrc={entry.light}
            alt={entry.alt}
            caption="Static view"
            href={demoHref}
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
      caption={<><strong>{entry.caption}</strong></>}
      href={demoHref}
    />
  )
}
