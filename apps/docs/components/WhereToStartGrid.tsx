/** "Where to start?" decision grid — three paths by intent. */
'use client'

import Link from 'next/link'
import { LANDING_WHERE_TO_START, type LandingPathCard } from '@/lib/landing-copy'

interface WhereToStartGridProps {
  paths?: readonly LandingPathCard[]
}

export function WhereToStartGrid({ paths = LANDING_WHERE_TO_START }: WhereToStartGridProps) {
  return (
    <ul className="docs-quickstart-grid not-prose list-none p-0 m-0" aria-label="Where to start">
      {paths.map((p) => (
        <li key={p.title} className="list-none">
          <Link href={p.href} className="docs-quickstart-card">
            <h3 className="docs-quickstart-card__title">{p.title}</h3>
            <p className="docs-quickstart-card__desc">{p.desc}</p>
            {p.cmd ? (
              <code className="docs-quickstart-card__cmd">{p.cmd}</code>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}
