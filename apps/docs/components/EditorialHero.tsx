/** Page-level editorial hero used by the docs landing (and any */

import type { ReactNode } from 'react'

interface EditorialHeroProps {
  /** Small mono caps line above the title. Keep ≤ 60 characters. */
  eyebrow?: string
  /** Display headline. Wrap the single focal word in <em>…</em> for the
   *  vermillion accent. Keep ≤ 22ch so the responsive clamp doesn't break. */
  title: ReactNode
  /** Lead paragraph. Optional; omit for chapter covers that don't need
   *  body copy under the headline. */
  lead?: ReactNode
}

export function EditorialHero({ eyebrow, title, lead }: EditorialHeroProps) {
  return (
    <header className="docs-editorial-hero not-prose">
      {eyebrow ? (
        <p className="docs-editorial-hero__eyebrow">
          <span className="docs-editorial-hero__stamp" aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <h1 className="docs-editorial-hero__title">{title}</h1>
      {lead ? <p className="docs-editorial-hero__lead">{lead}</p> : null}
    </header>
  )
}
