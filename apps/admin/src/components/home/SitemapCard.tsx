/**
 * FILE: apps/admin/src/components/home/SitemapCard.tsx
 * PURPOSE: A small map of the app's busiest pages (last 7 days of visits,
 *          14 days of bug reports, the live-site watch's broken pages), as
 *          a two-level tree with a badge for visits, bugs and broken pages.
 *          Plain list markup: no canvas, works at phone width.
 */

import { Link } from 'react-router-dom'
import { Badge, Section, Skeleton } from '../ui'
import type { HomeSection, HomeSitemap, SitemapNode } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const INDENT = ['pl-0', 'pl-4', 'pl-8'] as const

export function SitemapCard({ section }: { section: HomeSection<HomeSitemap> }) {
  return (
    <Section title="Pages" id="home-sitemap">
      <HomeSectionBody
        section={section}
        what="your pages"
        notConnectedText="No page visits, bug reports or site checks yet. The SDK or the live-site watch fills this map."
      >
        {(map) => map.pages.length === 0 ? (
          <p className="text-sm text-fg-muted">No pages in this map yet.</p>
        ) : (
          <>
            <ul className="space-y-0.5" data-testid="home-sitemap" aria-label="Your app's busiest pages">
              {map.pages.map((p) => (
                <PageRow key={p.path} page={p} />
              ))}
            </ul>
            <p className="mt-2 text-2xs text-fg-faint">
              {map.pages.length} of {map.totalPages} pages, by visits in the last 7 days{map.sampled ? ' (from the latest 5,000 visits)' : ''}, bug reports in the last 14 days and broken pages.
            </p>
          </>
        )}
      </HomeSectionBody>
    </Section>
  )
}

function PageRow({ page: p }: { page: SitemapNode }) {
  return (
    <li className={`${INDENT[Math.min(p.depth, 2)]} min-w-0`}>
      <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm py-1 ${p.depth > 0 ? 'border-l border-edge-subtle pl-2' : ''}`}>
        <span className="min-w-0 max-w-full truncate font-mono text-xs text-fg" title={p.path}>
          {p.depth === 0 ? 'Home (/)' : p.path}
        </span>
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          {p.views > 0 && <Badge tone="neutral">{p.views} {p.views === 1 ? 'visit' : 'visits'}</Badge>}
          {p.bugs > 0 && (
            <Link to="/reports?days=14" aria-label={`${p.bugs} bug reports on ${p.path}`}>
              <Badge tone="warnSubtle">
                {p.bugs} {p.bugs === 1 ? 'bug' : 'bugs'}
              </Badge>
            </Link>
          )}
          {p.broken && (
            <Link to="/inventory?tab=discovery" aria-label={`${p.path} is broken`}>
              <Badge tone="dangerSubtle">Broken</Badge>
            </Link>
          )}
        </span>
      </div>
    </li>
  )
}

export function SitemapSkeleton() {
  return (
    <Section title="Pages">
      <div className="space-y-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </Section>
  )
}
