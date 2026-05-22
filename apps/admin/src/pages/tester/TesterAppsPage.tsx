/**
 * TesterAppsPage — browse and join apps published to Mushi Bounties.
 */
import { useState } from 'react'
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../../components/ui'

interface PublicApp {
  id: string
  projectId: string
  name: string
  tagline: string | null
  description: string | null
  logoUrl: string | null
  platforms: string[]
  baseBountyPoints: number
  reputationMin: number
  targetCountries: string[] | null
  publishedAt: string
  isJoined: boolean
  openSlots: number | null
}

export function TesterAppsPage() {
  const { data: apps, loading, reload } = usePageData<PublicApp[]>('/v1/tester/apps')
  const [joiningId, setJoiningId] = useState<string | null>(null)

  const handleJoin = async (appId: string) => {
    setJoiningId(appId)
    try {
      await apiFetch(`/v1/tester/apps/${appId}/join`, { method: 'POST' })
      reload()
    } catch {
      // error handled by apiFetch toast
    } finally {
      setJoiningId(null)
    }
  }

  return (
    <TesterLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-bold">Browse Apps</h1>
          <p className="text-sm text-fg-muted mt-0.5">
            Pick an app, find a bug, earn mushi-points.
          </p>
        </div>

        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-lg bg-surface animate-pulse" />
            ))}
          </div>
        )}

        {!loading && (!apps || apps.length === 0) && (
          <div className="rounded-lg border border-edge bg-surface p-8 text-center">
            <p className="text-2xl mb-2">📭</p>
            <p className="text-sm font-medium text-fg">No apps listed yet</p>
            <p className="text-2xs text-fg-muted mt-1">
              Check back soon — developers are publishing their apps to Mushi Bounties.
            </p>
          </div>
        )}

        {!loading && apps && apps.length > 0 && (
          <div className="space-y-3">
            {apps.map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-4 rounded-lg border border-edge bg-surface p-4 hover:border-edge-strong motion-safe:transition-colors"
              >
                {app.logoUrl ? (
                  <img
                    src={app.logoUrl}
                    alt={app.name}
                    className="h-12 w-12 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-surface-raised flex items-center justify-center text-xl shrink-0">
                    📱
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{app.name}</p>
                      {app.tagline && (
                        <p className="text-2xs text-fg-muted mt-0.5">{app.tagline}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {app.isJoined ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-2xs font-medium text-ok">
                          ✓ Joined
                        </span>
                      ) : (
                        <Btn
                          size="sm"
                          disabled={joiningId === app.id}
                          onClick={() => handleJoin(app.id)}
                        >
                          {joiningId === app.id ? 'Joining…' : 'Join'}
                        </Btn>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-2xs text-fg-secondary">
                      🏆 {app.baseBountyPoints} pts/bug
                    </span>
                    {app.platforms.length > 0 && (
                      <span className="text-2xs text-fg-secondary">
                        📲 {app.platforms.join(', ')}
                      </span>
                    )}
                    {app.reputationMin > 0 && (
                      <span className="text-2xs text-fg-secondary">
                        ⭐ Rep {app.reputationMin}+ required
                      </span>
                    )}
                    {app.openSlots !== null && (
                      <span className="text-2xs text-fg-secondary">
                        👥 {app.openSlots} slots left
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TesterLayout>
  )
}
