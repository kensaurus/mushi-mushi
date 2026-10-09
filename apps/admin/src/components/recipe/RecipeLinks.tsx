/**
 * FILE: apps/admin/src/components/recipe/RecipeLinks.tsx
 * PURPOSE: Render server-supplied links safely. Targets can come from a
 *          repo's manifest, so only an in-app path (`/…`) becomes a router
 *          Link and only `https://…` becomes an external anchor; anything
 *          else is shown as plain text.
 */

import { Link } from 'react-router-dom'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { RecipeLink } from '../../lib/recipeTypes'
import { classifyLinkTarget } from './recipeState'

function SafeLink({ to, children }: { to: string; children: React.ReactNode }) {
  const kind = classifyLinkTarget(to)
  if (kind === 'internal') {
    return (
      <Link to={to} className={`text-xs ${LINK_ACCENT}`}>
        {children}
      </Link>
    )
  }
  if (kind === 'external') {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={`text-xs ${LINK_ACCENT}`}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  }
  return (
    <span className="text-xs text-fg-secondary">
      {children} <span className="font-mono text-fg-faint">({to})</span>
    </span>
  )
}

export function RecipeLinkList({ links, empty, layout = 'column' }: { links: RecipeLink[]; empty?: string; layout?: 'column' | 'row' }) {
  if (links.length === 0) {
    return empty ? <p className="text-xs text-fg-muted">{empty}</p> : null
  }
  return (
    <ul className={layout === 'row' ? 'flex flex-wrap gap-x-3 gap-y-1' : 'flex flex-col gap-1'}>
      {links.map((l) => (
        <li key={`${l.label}:${l.to}`}>
          <SafeLink to={l.to}>{l.label}</SafeLink>
        </li>
      ))}
    </ul>
  )
}
