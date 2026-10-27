/**
 * FILE: apps/admin/src/components/home/AppCard.tsx
 * PURPOSE: The Home top band's app card: a picture of the live site (or the
 *          app's store icon, then its favicon, then its initials), its name,
 *          live address, platforms and the version last seen deployed.
 *
 *          Refresh takes a new screenshot on the app's own Firecrawl key
 *          (POST …/home/thumbnail). When it cannot, the card says why
 *          instead of showing a dead button.
 */

import { useState } from 'react'
import { Badge, Btn, Card, RelativeTime, Skeleton } from '../ui'
import { ProjectFavicon } from '../ProjectFavicon'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { hostOf, type HomeApp, type HomeSection, type Platform } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const PLATFORM_LABEL: Record<Platform, string> = { web: 'Web', ios: 'iOS', android: 'Android' }

interface Props {
  section: HomeSection<HomeApp>
  projectId: string
  /** False for a viewer: Refresh is hidden. */
  canEdit: boolean
  onRefreshed: () => void
}

export function AppCard({ section, projectId, canEdit, onRefreshed }: Props) {
  return (
    <Card className="min-w-0 overflow-hidden" data-testid="home-app-card">
      <HomeSectionBody section={section} what="the app" notConnectedText="This app has no details yet.">
        {(app) => <AppCardBody app={app} projectId={projectId} canEdit={canEdit} onRefreshed={onRefreshed} />}
      </HomeSectionBody>
    </Card>
  )
}

function AppCardBody({ app, projectId, canEdit, onRefreshed }: { app: HomeApp; projectId: string; canEdit: boolean; onRefreshed: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [broken, setBroken] = useState(false)
  const shot = app.thumbnail && !broken ? app.thumbnail : null
  const host = hostOf(app.liveUrl)

  async function refresh() {
    setBusy(true)
    const res = await apiFetch<{ url: string | null }>(`/v1/admin/projects/${projectId}/home/thumbnail`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      toast.error('No new screenshot', res.error?.message ?? 'Try again in a moment.')
      return
    }
    setBroken(false)
    toast.success('Screenshot updated', host ? `A fresh picture of ${host}.` : undefined)
    onRefreshed()
  }

  return (
    <div className="flex flex-col">
      <div className="relative aspect-video w-full overflow-hidden border-b border-edge-subtle bg-surface-overlay">
        {shot ? (
          <img
            src={shot.url}
            alt={`Screenshot of ${host ?? app.name}`}
            loading="lazy"
            className="h-full w-full object-cover object-top"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            <ProjectFavicon
              size={40}
              project_id={projectId}
              project_name={app.name}
              project_slug={app.slug ?? app.name}
              icon_url={app.iconUrl}
              sdk_origin={app.sdkOrigin}
              repo_url={app.repoUrl}
            />
            <p className="text-2xs text-fg-muted">{app.thumbnailState.reason ?? 'No screenshot yet.'}</p>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{app.name}</h2>
            {app.liveUrl ? (
              <a href={app.liveUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-link hover:underline">
                {host} ↗
              </a>
            ) : (
              <p className="text-xs text-fg-muted">No live address yet</p>
            )}
          </div>
          {canEdit && app.thumbnailState.canRefresh && (
            <Btn size="sm" variant="ghost" onClick={() => void refresh()} loading={busy}>
              Refresh picture
            </Btn>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {app.platforms.map((p) => (
            <Badge key={p} tone="neutral">
              {PLATFORM_LABEL[p]}
            </Badge>
          ))}
          {app.version ? (
            <Badge tone="info" title={`Seen live ${new Date(app.version.at).toLocaleString()}`}>
              {app.version.value}
            </Badge>
          ) : (
            <span className="text-2xs text-fg-faint">No deploy seen yet</span>
          )}
        </div>
        {shot?.capturedAt && (
          <p className="text-2xs text-fg-faint">
            Picture taken <RelativeTime value={shot.capturedAt} />
          </p>
        )}
        {app.thumbnailState.lastError && !shot && <p className="text-2xs text-warn-foreground">Last screenshot failed: {app.thumbnailState.lastError}</p>}
      </div>
    </div>
  )
}

export function AppCardSkeleton() {
  return (
    <Card className="min-w-0 overflow-hidden">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </Card>
  )
}
