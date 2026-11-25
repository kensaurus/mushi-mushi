import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/ui'
import { RevealedKeyCard } from '../RevealedKeyCard'
import { Btn, Tooltip, CopyButton, RelativeTime, InfoHint } from '../ui'
import { CodeInline } from '../CodePanel'
import { apiFetch, invalidateApiCache } from '../../lib/supabase'
import { diagnoseKey, type SdkHealthApiKey } from '../SdkHealthSummary'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { RotateKeyDialog } from '../RotateKeyDialog'
import { canRotateKey } from '../../lib/projectKeys'
import { describeActionError } from '../../lib/actionError'
import { ConfirmDialog } from '../ConfirmDialog'
import { staleKeysToRevoke } from '../../lib/staleKeys'

/**
 * How many keys to show before collapsing behind "Show all". Long-lived
 * projects accumulate a dozen e2e/test keys; a raw wall of prefixes was one
 * of the "hard to integrate from the console" complaints — the key you need
 * is the recently-used one, so recency sorts first and the tail collapses.
 */
const VISIBLE_KEY_LIMIT = 4

/** What each key mark means, behind the (i) beside the list. */
const KEY_LEGEND =
  'Healthy: the SDK used this key in the last hour. Quiet: no activity in the last hour (normal for a low-traffic app). ' +
  'Cold: nothing for over 7 days, so the deploy may have stopped shipping the SDK. Never used: no app has used it yet. ' +
  'Revoke stale keys takes only the keys marked unused 7d+, never the one your app used last.'

/**
 * A key's health as a status mark (2026-11-18): ✓ live, ✕ wrong endpoint,
 * ○ quiet (grey: an hour without traffic is normal), ⧗ cold 7d+, ○ never used, ⊘ off.
 */
const KEY_STATUS: Record<ReturnType<typeof diagnoseKey>['status'], RunStatus> = {
  healthy: 'passed',
  'endpoint-mismatch': 'failed',
  stale: 'idle',
  cold: 'slow',
  never: 'idle',
  inactive: 'cancelled',
}

export function SdkInstallKeyPanel({
  projectId,
  projectSlug,
  apiKey,
  keyPrefixes,
  onRotatedKeyChange,
  onError,
  flat = false,
}: {
  projectId: string
  projectSlug?: string | null
  apiKey?: string | null
  keyPrefixes?: string[]
  onRotatedKeyChange: (key: string | null) => void
  onError: (message: string) => void
  /** Inside a card already: draw rows, not nested cards. */
  flat?: boolean
}) {
  const Box = flat ? FlatBox : Card
  const [fetchedKeys, setFetchedKeys] = useState<SdkHealthApiKey[]>([])
  const [minting, setMinting] = useState(false)
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)
  const [rotatedScopes, setRotatedScopes] = useState<string[]>(['report:write'])
  // The one key the user asked to rotate; the confirm lists exactly this key.
  const [pendingRotate, setPendingRotate] = useState<SdkHealthApiKey | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [confirmStale, setConfirmStale] = useState(false)
  const [revokingStale, setRevokingStale] = useState(false)

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

  // One action for the pile of old e2e/test keys (owner, 2026-11-18): SDK keys
  // unused for over 7 days, never the one the app runs on (lib/staleKeys.ts).
  const staleKeys = useMemo(() => staleKeysToRevoke(activeKeys), [activeKeys])
  const staleIds = useMemo(() => new Set(staleKeys.map((k) => k.id)), [staleKeys])

  /** Revoke the stale keys one by one with the per-key revoke (DELETE …/keys/:keyId). */
  async function revokeStaleKeys() {
    setRevokingStale(true)
    const done = new Set<string>()
    const failed: string[] = []
    for (const k of staleKeys) {
      const res = await apiFetch(`/v1/admin/projects/${projectId}/keys/${k.id}`, { method: 'DELETE' })
      // Already revoked elsewhere counts as done.
      if (res.ok || res.error?.code === 'KEY_NOT_FOUND') done.add(k.id)
      else failed.push(`${k.key_prefix}… (${describeActionError(res.error, 'could not revoke')})`)
    }
    setRevokingStale(false)
    setConfirmStale(false)
    setFetchedKeys((prev) => prev.filter((k) => !done.has(k.id)))
    invalidateApiCache('/v1/admin/projects')
    if (failed.length > 0) onError(`Revoked ${done.size} of ${staleKeys.length} stale keys. Not revoked: ${failed.join(', ')}.`)
  }

  const visibleKeys = showAll ? activeKeys : activeKeys.slice(0, VISIBLE_KEY_LIMIT)
  // Never-used keys sort last; two or more share one "Never used · N" heading
  // instead of the same pill on every row (round-2 review 2026-11-18).
  const neverIds = visibleKeys.filter((k) => k.created_at && !k.last_seen_at).map((k) => k.id)
  const groupNever = neverIds.length >= 2
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
    const res = await apiFetch<{ id?: string | null; key: string; prefix: string; label?: string }>(
      `/v1/admin/projects/${projectId}/keys`,
      {
        method: 'POST',
        body: JSON.stringify({ scopes: ['report:write'] }),
        idempotencyKey: crypto.randomUUID(),
      },
    )
    setMinting(false)
    if (res.ok && res.data?.key) {
      setRotatedKey(res.data.key)
      setRotatedScopes(['report:write'])
      setFetchedKeys((prev) => [
        {
          // The real row id (when the API sends it) lets this key be rotated later.
          id: res.data!.id ?? res.data!.prefix,
          key_prefix: res.data!.prefix,
          label: res.data!.label ?? 'sdk-ingest',
          scopes: ['report:write'],
          is_active: true,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
      invalidateApiCache('/v1/admin/projects')
    } else {
      onError(describeActionError(res.error, 'Could not mint an SDK key. Try again in a moment.'))
    }
  }

  return (
    <>
      {!apiKey && activeKeys.length > 0 && (
        <Box className={flat ? 'space-y-2' : 'px-3 py-2.5 space-y-2'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs font-medium text-fg-secondary">
              Active API key{activeKeys.length > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1.5">
              {staleKeys.length > 0 && (
                <Tooltip content="SDK keys no app has used for over 7 days. The key your app used last stays. You confirm first." side="top">
                  <Btn size="sm" variant="ghost" onClick={() => setConfirmStale(true)} data-testid="revoke-stale-keys">
                    Revoke {staleKeys.length} stale key{staleKeys.length === 1 ? '' : 's'}
                  </Btn>
                </Tooltip>
              )}
              <Tooltip
                content="Makes a new key that can only send bug reports and fills it into the snippet below. Your other keys keep working."
                side="top"
              >
                <Btn size="sm" variant="primary" disabled={minting} onClick={() => void mintSdkKey()}>
                  {minting ? 'Making a key…' : 'Make a key and fill it in'}
                </Btn>
              </Tooltip>
            </div>
          </div>
          <ul className={flat ? 'divide-y divide-edge-subtle' : 'space-y-1.5'} aria-label="Active API keys">
            {visibleKeys.map((k) => {
              const diag = k.created_at ? diagnoseKey(k, null) : null
              const inNeverGroup = groupNever && diag?.status === 'never'
              return (
                <li key={k.id}>
                  {inNeverGroup && k.id === neverIds[0] && (
                    <div className="flex items-center gap-1.5 pt-1.5" data-testid="sdk-key-never-group">
                      <Tooltip content={diag.description} side="top">
                        <span className="shrink-0" data-key-status="never">
                          <StatusPill status={KEY_STATUS.never} label={`Never used · ${neverIds.length}`} />
                        </span>
                      </Tooltip>
                    </div>
                  )}
                  {/* The key chip never wraps (at 390px it broke one character
                      per line). Prefix and label share the first line; on a
                      phone the status and buttons move to a second one. */}
                  <div
                    className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${
                      flat ? 'py-1.5' : 'rounded-sm border border-edge-subtle/80 bg-surface-root/50 px-2 py-1.5'
                    }`}
                    data-testid="sdk-key-row"
                  >
                    <div className="flex min-w-0 flex-1 basis-full items-center gap-1.5 sm:basis-0">
                      <Tooltip
                        content={`Prefix ${k.key_prefix} — full secret shown once at mint or rotate`}
                        side="top"
                      >
                        <CodeInline className="w-32 shrink-0 truncate whitespace-nowrap">{k.key_prefix}…</CodeInline>
                      </Tooltip>
                      {staleIds.has(k.id) && (
                        <span className="shrink-0 whitespace-nowrap text-3xs font-bold text-warn-foreground" title="No app has used it for over 7 days: Revoke stale keys takes it">
                          unused 7d+
                        </span>
                      )}
                      {k.label && (
                        <span className="min-w-0 truncate whitespace-nowrap text-3xs text-fg-muted" title={k.label}>
                          {k.label}
                        </span>
                      )}
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {diag && !inNeverGroup && (
                      <Tooltip content={diag.description} side="top">
                        <span className="shrink-0" data-key-status={diag.status}>
                          <StatusPill status={KEY_STATUS[diag.status]} label={diag.label} />
                        </span>
                      </Tooltip>
                    )}
                    {canRotateKey(k) && (
                      <Tooltip
                        content="Replace this one key. You confirm first; your other keys keep working."
                        side="top"
                      >
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingRotate(k)}
                          aria-label={`Rotate key ${k.key_prefix}`}
                        >
                          Rotate
                        </Btn>
                      </Tooltip>
                    )}
                    <CopyButton value={k.key_prefix} label="Copy prefix" copiedLabel="Copied" size="sm" />
                    </div>
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
          {/* One line; what each mark means sits behind the (i). */}
          <p className="flex items-center gap-1.5 text-2xs text-fg-muted" data-testid="sdk-key-legend">
            <span>A key shows in full only once, when made or rotated.</span>
            <InfoHint content={KEY_LEGEND} />
          </p>
        </Box>
      )}

      {!apiKey && activeKeys.length === 0 && (
        <Box className={flat ? 'flex flex-wrap items-center justify-between gap-2' : 'px-3 py-2.5 flex flex-wrap items-center justify-between gap-2'}>
          <span className="text-2xs text-fg-secondary">
            No key yet. Make one and it fills into the snippet below.
          </span>
          <Btn size="sm" variant="primary" disabled={minting} onClick={() => void mintSdkKey()}>
            {minting ? 'Making a key…' : 'Make a key and fill it in'}
          </Btn>
        </Box>
      )}

      {confirmStale && staleKeys.length > 0 && (
        <ConfirmDialog
          title={`Revoke ${staleKeys.length} stale key${staleKeys.length === 1 ? '' : 's'}?`}
          body="No app has used these SDK keys for over 7 days, or they were made more than 7 days ago and never used. Revoking is permanent: a build that still carries one stops sending bug reports. The key your app used last is not on the list."
          details={
            <ul className="space-y-0.5 font-mono text-2xs" aria-label="Keys to revoke">
              {staleKeys.map((k) => (
                <li key={k.id} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-fg">{k.key_prefix}…</span>
                  {k.label && <span className="text-fg-secondary">{k.label}</span>}
                  <span className="text-fg-secondary">
                    {k.last_seen_at ? (
                      <>
                        last used <RelativeTime value={k.last_seen_at} />
                      </>
                    ) : (
                      'never used'
                    )}
                  </span>
                </li>
              ))}
            </ul>
          }
          confirmLabel={`Revoke ${staleKeys.length}`}
          cancelLabel="Keep them"
          tone="danger"
          loading={revokingStale}
          onConfirm={() => void revokeStaleKeys()}
          onCancel={() => {
            if (!revokingStale) setConfirmStale(false)
          }}
        />
      )}

      {pendingRotate && (
        <RotateKeyDialog
          projectId={projectId}
          apiKey={pendingRotate}
          onCancel={() => setPendingRotate(null)}
          onError={(message) => {
            setPendingRotate(null)
            onError(message)
          }}
          onRotated={(rotated) => {
            const old = pendingRotate
            setPendingRotate(null)
            setRotatedKey(rotated.key)
            setRotatedScopes(rotated.scopes)
            setFetchedKeys((prev) => [
              {
                id: rotated.id ?? rotated.prefix,
                key_prefix: rotated.prefix,
                label: rotated.label,
                scopes: rotated.scopes,
                is_active: true,
                created_at: new Date().toISOString(),
              },
              ...(rotated.oldKeyStillActive ? prev : prev.filter((k) => k.id !== old.id)),
            ])
            invalidateApiCache('/v1/admin/projects')
            if (rotated.oldKeyStillActive) {
              onError(
                `New key created, but ${old.key_prefix}… is still active. Revoke it under Projects → Your projects → Keys.`,
              )
            }
          }}
        />
      )}

      {rotatedKey && (
        <RevealedKeyCard
          projectId={projectId}
          projectName={projectSlug ?? 'project'}
          projectSlug={projectSlug}
          apiKey={rotatedKey}
          scopes={rotatedScopes}
          onDismiss={() => setRotatedKey(null)}
        />
      )}
    </>
  )
}

/** A plain block for `flat` mode, same props as Card. */
function FlatBox({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>
}
