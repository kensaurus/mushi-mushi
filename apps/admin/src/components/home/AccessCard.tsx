/**
 * FILE: apps/admin/src/components/home/AccessCard.tsx
 * PURPOSE: Who and what can reach this app: its repo, its people, the SDK
 *          version against the latest, its keys (label and last use only,
 *          never a key) and where its logs are.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, RelativeTime, Section, Skeleton, type BadgeTone } from '../ui'
import { initialsOf, type HomeAccess, type HomeSection, type SdkFreshness } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const SDK_TONE: Record<SdkFreshness, { tone: BadgeTone; text: string }> = {
  'up-to-date': { tone: 'okSubtle', text: 'Up to date' },
  outdated: { tone: 'warnSubtle', text: 'Update available' },
  deprecated: { tone: 'dangerSubtle', text: 'No longer supported' },
  unknown: { tone: 'neutral', text: 'Version not seen yet' },
}

const KIND_LABEL = { sdk: 'SDK', mcp: 'Editor (MCP)', other: 'Other' } as const

interface Props {
  section: HomeSection<HomeAccess>
  /** The plan includes the audit log (enterprise). */
  auditLog: boolean
}

export function AccessCard({ section, auditLog }: Props) {
  return (
    <Section title="Access and details" id="home-access">
      <HomeSectionBody section={section} what="access and details" notConnectedText="No details yet.">
        {(a) => (
          <dl className="space-y-3 text-sm" data-testid="home-access">
            <Row term="Repo">
              {a.repo ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <a href={a.repo.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-link hover:underline">
                    {a.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, '')} ↗
                  </a>
                  {a.repo.branch && <Badge tone="neutral">{a.repo.branch}</Badge>}
                </span>
              ) : (
                <Link to="/connect" className="text-link hover:underline">Connect your repo</Link>
              )}
            </Row>
            <Row term="People">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="flex -space-x-1.5">
                  {a.members.people.map((m, i) => (
                    <Avatar key={`${m.name}-${i}`} name={m.name} url={m.avatarUrl} role={m.role} />
                  ))}
                </span>
                <Link to="/team?view=members" className="text-xs text-link hover:underline">
                  {a.members.total} {a.members.total === 1 ? 'person' : 'people'}
                </Link>
              </span>
            </Row>
            <Row term="SDK">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-fg">{a.sdk.version ? `${a.sdk.package ?? 'SDK'} ${a.sdk.version}` : 'Not seen yet'}</span>
                {a.sdk.latest && a.sdk.status !== 'up-to-date' && <span className="text-xs text-fg-muted">latest {a.sdk.latest}</span>}
                <Link to="/connect">
                  <Badge tone={SDK_TONE[a.sdk.status].tone}>{SDK_TONE[a.sdk.status].text}</Badge>
                </Link>
              </span>
            </Row>
            <Row term="Keys">
              {!a.keysReadable ? (
                <span className="text-xs text-danger-foreground">Could not read the keys just now.</span>
              ) : a.keys.length === 0 ? (
                <Link to="/projects" className="text-link hover:underline">Create a key</Link>
              ) : (
                <ul className="space-y-1">
                  {a.keys.map((k, i) => (
                    <li key={`${k.label}-${i}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="min-w-0 truncate text-fg">{k.label}</span>
                      <Badge tone="neutral">{KIND_LABEL[k.kind]}</Badge>
                      <span className="text-fg-muted">
                        {k.lastUsedAt ? (
                          <>
                            used <RelativeTime value={k.lastUsedAt} />
                          </>
                        ) : (
                          'never used'
                        )}
                      </span>
                    </li>
                  ))}
                  {a.keysTotal > a.keys.length && (
                    <li>
                      <Link to="/projects" className="text-xs text-link hover:underline">
                        All {a.keysTotal} keys →
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </Row>
            <Row term="Logs">
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link to="/fixes" className="text-link hover:underline">Fix history</Link>
                <Link to="/dashboard?view=users" className="text-link hover:underline">User activity</Link>
                {auditLog && <Link to="/team?view=audit" className="text-link hover:underline">Audit log</Link>}
              </span>
            </Row>
            <Row term="Created">
              <span className="text-xs text-fg-secondary">
                <RelativeTime value={a.createdAt} />
              </span>
            </Row>
          </dl>
        )}
      </HomeSectionBody>
    </Section>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-4 sm:gap-3">
      <dt className="text-2xs font-medium uppercase tracking-wider text-fg-muted sm:pt-0.5">{term}</dt>
      <dd className="min-w-0 sm:col-span-3">{children}</dd>
    </div>
  )
}

function Avatar({ name, url, role }: { name: string | null; url: string | null; role: string }) {
  const label = `${name ?? 'Someone'} (${role})`
  if (url) return <img src={url} alt={label} title={label} className="h-7 w-7 rounded-full border-2 border-surface-raised object-cover" loading="lazy" />
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-raised bg-surface-overlay text-2xs font-semibold text-fg-secondary">
      {initialsOf(name)}
    </span>
  )
}

export function AccessSkeleton() {
  return (
    <Section title="Access and details">
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </Section>
  )
}
