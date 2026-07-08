import { useEffect, useMemo, useState } from 'react'
import { RevealedKeyCard } from '../RevealedKeyCard'
import { Btn, Tooltip, CopyButton } from '../ui'
import { CodeInline } from '../CodePanel'
import { apiFetch, invalidateApiCache } from '../../lib/supabase'
import { diagnoseKey, type SdkHealthApiKey } from '../SdkHealthSummary'
import { CHIP_TONE } from '../../lib/chipTone'

/**
 * How many keys to show before collapsing behind "Show all". Long-lived
 * projects accumulate a dozen e2e/test keys; a raw wall of prefixes was one
 * of the "hard to integrate from the console" complaints — the key you need
 * is the recently-used one, so recency sorts first and the tail collapses.
 */
const VISIBLE_KEY_LIMIT = 4

const KEY_CHIP_CLASS: Record<ReturnType<typeof diagnoseKey>['status'], string> = {
  healthy: CHIP_TONE.okSubtle,
  'endpoint-mismatch': CHIP_TONE.dangerSubtle,
  stale: CHIP_TONE.warnSubtle,
  cold: CHIP_TONE.warnSubtle,
  never: CHIP_TONE.neutral,
  inactive: CHIP_TONE.neutral,
}

export function SdkInstallKeyPanel({
  projectId,
  projectSlug,
  apiKey,
  keyPrefixes,
  onRotatedKeyChange,
  onError,
}: {
  projectId: string
  projectSlug?: string | null
  apiKey?: string | null
  keyPrefixes?: string[]
  onRotatedKeyChange: (key: string | null) => void
  onError: (message: string) => void
}) {
  const [fetchedKeys, setFetchedKeys] = useState<SdkHealthApiKey[]>([])
  const [rotating, setRotating] = useState(false)
  const [minting, setMinting] = useState(false)
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    onRotatedKeyChange(rotatedKey)
  }, [rotatedKey, onRotatedKeyChange])

  useEffect(() => {
    if (apiKey) return
    let cancelled = false
    void apiFetch<{ projects: Array<{ id: string; api_keys: SdkHealthApiKey[] }> }>(
      '/v1/admin/projects',
    ).then((res) => {
      if (cancelled || !res.ok || !res.data) return
      // `/v1/admin/projects` keys each row by internal `id` (no `project_id`
      // field); `projectId` passed into this card is that same internal UUID.
      const row = res.data.projects.find((p) => p.id === projectId)
      setFetchedKeys((row?.api_keys ?? []).filter((k) => k.is_active))
    })
    return () => {
      cancelled = true
    }
  }, [apiKey, projectId])

  // Explicit keyPrefixes prop (ProjectsPage) narrows the fetched set; when the
  // fetch hasn't landed (or was narrowed to nothing) fall back to bare-prefix
  // rows so the panel never renders emptier than before this upgrade.
  const activeKeys = useMemo(() => {
    const base = keyPrefixes?.length
      ? fetchedKeys.filter((k) => keyPrefixes.includes(k.key_prefix))
      : fetchedKeys
    const rows = base.length
      ? base
      : (keyPrefixes ?? []).map<SdkHealthApiKey>((p) => ({
          id: p,
          key_prefix: p,
          is_active: true,
          created_at: '',
        }))
    // Most recently heard-from first — that's the key your app is using.
    return [...rows].sort((a, b) => {
      const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
      const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
      return tb - ta
    })
  }, [fetchedKeys, keyPrefixes])

  const visibleKeys = showAll ? activeKeys : activeKeys.slice(0, VISIBLE_KEY_LIMIT)
  const hiddenCount = activeKeys.length - visibleKeys.length

  /**
   * Mint a fresh least-privilege (report:write) SDK key without touching
   * existing keys. This is the "I just want to integrate" path — the minted
   * secret flows into the snippet via onRotatedKeyChange so users copy one
   * paste-ready block instead of hopping to the Projects page. Rotate stays
   * for the revoke-and-replace case.
   */
  async function mintSdkKey() {
    setMinting(true)
    const res = await apiFetch<{ key: string; prefix: string }>(`/v1/admin/projects/${projectId}/keys`, {
      method: 'POST',
      body: JSON.stringify({ scopes: ['report:write'] }),
    })
    setMinting(false)
    if (res.ok && res.data?.key) {
      setRotatedKey(res.data.key)
      setFetchedKeys((prev) => [
        {
          id: res.data!.prefix,
          key_prefix: res.data!.prefix,
          label: 'sdk-ingest',
          is_active: true,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
      invalidateApiCache('/v1/admin/projects')
    } else {
      onError(res.error?.message ?? 'Key mint failed')
    }
  }

  async function rotateKey() {
    setRotating(true)
    const res = await apiFetch<{ key: string; prefix: string }>(`/v1/admin/projects/${projectId}/keys/rotate`, {
      method: 'POST',
    })
    setRotating(false)
    if (res.ok && res.data?.key) {
      setRotatedKey(res.data.key)
      setFetchedKeys([
        {
          id: res.data.prefix,
          key_prefix: res.data.prefix,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ])
      invalidateApiCache('/v1/admin/projects')
    } else {
      onError(res.error?.message ?? 'Key rotation failed')
    }
  }

  return (
    <>
      {!apiKey && activeKeys.length > 0 && (
        <div className="rounded-md border border-edge-subtle bg-surface-raised/60 px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs font-medium text-fg-secondary">
              Active API key{activeKeys.length > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <Tooltip
                content="Mints a new report:write key and drops it straight into the code snippet below. Existing keys keep working."
                side="top"
              >
                <Btn size="sm" variant="primary" disabled={minting} onClick={() => void mintSdkKey()}>
                  {minting ? 'Minting…' : 'Mint SDK key'}
                </Btn>
              </Tooltip>
              <Tooltip content="Revokes existing keys and replaces them with one new secret." side="top">
                <Btn size="sm" variant="ghost" disabled={rotating} onClick={() => void rotateKey()}>
                  {rotating ? 'Rotating…' : 'Rotate key'}
                </Btn>
              </Tooltip>
            </div>
          </div>
          <ul className="space-y-1.5" aria-label="Active API keys">
            {visibleKeys.map((k) => {
              const diag = k.created_at ? diagnoseKey(k, null) : null
              return (
                <li key={k.id}>
                  <div className="flex items-center justify-between gap-2 rounded-sm border border-edge-subtle/80 bg-surface-root/50 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Tooltip
                        content={`Prefix ${k.key_prefix} — full secret shown once at mint or rotate`}
                        side="top"
                      >
                        <CodeInline className="min-w-0 break-all">{k.key_prefix}…</CodeInline>
                      </Tooltip>
                      {k.label && (
                        <span
                          className="shrink-0 text-3xs text-fg-muted truncate max-w-[10rem]"
                          title={k.label}
                        >
                          {k.label}
                        </span>
                      )}
                    </div>
                    {diag && (
                      <Tooltip content={diag.description} side="top">
                        <span
                          className={`shrink-0 inline-flex items-center rounded-sm px-1.5 py-0.5 text-3xs font-medium ${KEY_CHIP_CLASS[diag.status]}`}
                        >
                          {diag.label}
                        </span>
                      </Tooltip>
                    )}
                    <CopyButton value={k.key_prefix} label="Copy prefix" copiedLabel="Copied" size="sm" />
                  </div>
                </li>
              )
            })}
          </ul>
          {hiddenCount > 0 && (
            <Btn size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show all {activeKeys.length} keys
            </Btn>
          )}
          {showAll && activeKeys.length > VISIBLE_KEY_LIMIT && (
            <Btn size="sm" variant="ghost" onClick={() => setShowAll(false)}>
              Show fewer
            </Btn>
          )}
          <p className="text-2xs text-fg-muted">
            Full secret shown once at mint or rotate. “Never used” keys were minted but no app has
            authenticated with them yet.
          </p>
        </div>
      )}

      {!apiKey && activeKeys.length === 0 && (
        <div className="rounded-md border border-edge-subtle bg-surface-raised/60 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs text-fg-secondary">
            No API key yet — mint one and it drops straight into the snippet below.
          </span>
          <Btn size="sm" variant="primary" disabled={minting} onClick={() => void mintSdkKey()}>
            {minting ? 'Minting…' : 'Mint SDK key'}
          </Btn>
        </div>
      )}

      {rotatedKey && (
        <RevealedKeyCard
          projectId={projectId}
          projectName={projectSlug ?? 'project'}
          projectSlug={projectSlug}
          apiKey={rotatedKey}
          scopes={['report:write']}
          onDismiss={() => setRotatedKey(null)}
        />
      )}
    </>
  )
}
