/**
 * FILE: apps/docs/components/EditorialHero.tsx
 * PURPOSE: Page-level editorial hero used by the docs landing (and any
 *   future "chapter cover" pages) to present a single focused headline +
 *   lead in the brand's washi/sumi/vermillion typography.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * The previous landing page used inline `style={{...}}` on a raw <div> with
 * `lineHeight: 0.95` + `fontSize: clamp(2.5rem, 7vw, 5.5rem)`. On any
 * viewport ≥1100px the second line of "Bugs your users feel, walked into
 * a fix." physically overlapped the first because 7vw on a 1440 viewport
 * (~100px) × 0.95 leading is shorter than the cap-height of the next line.
 * We move all visual rules into `globals.css` (`.docs-editorial-hero*`) so:
 *   1. The hero adopts the brand tokens by default and theme-toggles
 *      atomically with the rest of the site.
 *   2. The line-height and font-size cap can never be rewritten by a
 *      future MDX author by accident.
 *   3. The same component can be reused on chapter pages (concepts, sdks)
 *      without duplicating 30 lines of inline styles.
 *
 * ARIA / SEMANTIC NOTE
 * --------------------
 * The component renders a real <h1> so the hero IS the page heading — the
 * accompanying MDX must NOT also declare `# …` or we duplicate the H1
 * (NN/g #4 consistency violation and a real screen-reader bug). The
 * `_meta.ts` for the landing route also opts out of the auto-rendered
 * page-title to keep "Welcome / Mushi Mushi / hero title" from stacking
 * three competing names in one fold.
 *
 * USAGE
 * -----
 * In MDX:
 *   <EditorialHero
 *     eyebrow="Mushi · 虫々 · little bug helper"
 *     title={<>Bugs your users feel, walked into a <em>fix</em>.</>}
 *     lead="Mushi turns a wobbly checkout, confusing screen…"
 *   />
 *
 * Wrapping the focal word in `<em>` tints it vermillion via the CSS — that
 * is the *only* brand-coloured atom in the hero, which keeps the colour
 * budget at ≤1 per fold (see enhance-page-ui H4).
 */

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
