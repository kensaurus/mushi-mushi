/**
 * FILE: apps/admin/src/components/IdentitySecretCard.tsx
 * PURPOSE: Self-service console card for managing the per-project identity
 *          signing secret used by Mushi.identifyWithToken().
 *
 * OVERVIEW:
 *   Operators need a signing secret so their backend edge function can mint
 *   short-lived HS256 JWTs that the Mushi SDK forwards as X-Mushi-User-Token.
 *   This card lets operators:
 *     1. Generate / rotate the secret (returned show-once, API-key style).
 *     2. Copy it immediately into their env.
 *     3. See copy-paste instructions for the two places it must go:
 *        - The host app's edge function secret (MUSHI_IDENTITY_SECRET)
 *        - The Mushi project (stored in Vault via this card — done automatically)
 *
 * SECURITY:
 *   - The raw secret is shown ONCE after generation.  Reloading the page
 *     clears it from state permanently — it is never retrievable again.
 *   - The backend stores only a Vault UUID reference, never plaintext.
 *   - Rotating mints a new secret; old tokens become invalid immediately.
 *
 * DEPENDENCIES:
 *   - ../lib/supabase  : apiFetch
 *   - ../lib/toast     : useToast
 *   - ./ui             : Btn, Callout, CodeValue
 *
 * USAGE:
 *   Mounted below AssistantConfigCard in ProjectsPage per-project accordion.
 *   <IdentitySecretCard projectId={project.id} projectSlug={project.slug} />
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { Btn, Callout, CodeValue } from './ui'

interface SecretStatus {
  configured: boolean
  createdAt: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function IdentitySecretCard({
  projectId,
  projectSlug,
}: {
  projectId: string
  projectSlug?: string | null
}) {
  const toast = useToast()
  const [status, setStatus] = useState<SecretStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Raw secret is only held in memory and cleared on unmount / page reload.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const revealedRef = useRef<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    void apiFetch<SecretStatus>(`/v1/admin/projects/${projectId}/identity-secret`)
      .then((res) => {
        if (res.ok && res.data) setStatus(res.data)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    load()
    return () => {
      // Wipe the secret from memory on unmount so it can never leak to the
      // next render if the component is recycled inside a list.
      revealedRef.current = null
      setRevealedSecret(null)
    }
  }, [load])

  const generate = useCallback(async () => {
    setGenerating(true)
    const res = await apiFetch<{ secret: string; createdAt: string; configured: boolean }>(
      `/v1/admin/projects/${projectId}/identity-secret`,
      { method: 'POST' },
    )
    setGenerating(false)
    if (res.ok && res.data) {
      revealedRef.current = res.data.secret
      setRevealedSecret(res.data.secret)
      setStatus({ configured: true, createdAt: res.data.createdAt })
      toast.success('Identity secret generated — copy it now, it won\'t be shown again.')
    } else {
      toast.error('Failed to generate identity secret')
    }
  }, [projectId, toast])

  const remove = useCallback(async () => {
    if (!confirm('Disable signed identity? All existing tokens will stop verifying immediately.')) return
    setDeleting(true)
    const res = await apiFetch<{ configured: boolean }>(
      `/v1/admin/projects/${projectId}/identity-secret`,
      { method: 'DELETE' },
    )
    setDeleting(false)
    if (res.ok) {
      setStatus({ configured: false, createdAt: null })
      setRevealedSecret(null)
      revealedRef.current = null
      toast.success('Identity secret disabled')
    } else {
      toast.error('Failed to disable identity secret')
    }
  }, [projectId, toast])

  if (loading) {
    return <div className="text-2xs text-fg-faint px-1 py-2">Loading identity secret…</div>
  }

  const envBlock = revealedSecret
    ? `MUSHI_IDENTITY_SECRET="${revealedSecret}"\nMUSHI_PROJECT_ID="${projectId}"`
    : null

  const isConfigured = status?.configured ?? false

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-fg">Signed identity</div>
          <div className="text-2xs text-fg-muted">
            Lets your app mint verified end-user tokens so reports are account-linked and{' '}
            <span className="font-medium">My Reports</span> shows real data.
            {isConfigured && (
              <span className="ml-1 text-fg-faint">
                Active since {formatDate(status?.createdAt ?? null)}.
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Btn
            size="sm"
            variant={isConfigured ? 'ghost' : 'primary'}
            loading={generating}
            onClick={generate}
          >
            {isConfigured ? 'Rotate secret' : 'Generate secret'}
          </Btn>
          {isConfigured && (
            <Btn size="sm" variant="danger" loading={deleting} onClick={remove}>
              Disable
            </Btn>
          )}
        </div>
      </div>

      {revealedSecret && (
        <div className="space-y-2 rounded-md border border-warn/40 bg-warn/5 p-3">
          <Callout tone="warn" label="Copy now — this secret will not be shown again.">
            Store it securely. If you lose it, rotate to get a new one (old tokens will stop
            working immediately).
          </Callout>

          <div className="space-y-1">
            <div className="text-2xs text-fg-muted font-medium">
              Secret (set as an edge-function secret):
            </div>
            <CodeValue value={revealedSecret} copyable multiline />
          </div>

          {envBlock && (
            <div className="space-y-1">
              <div className="text-2xs text-fg-muted font-medium">
                Env block for your edge function:
              </div>
              <CodeValue value={envBlock} copyable multiline />
            </div>
          )}
        </div>
      )}

      {!revealedSecret && isConfigured && (
        <Callout tone="info" label="Next step">
          Make sure <code>MUSHI_IDENTITY_SECRET</code> and <code>MUSHI_PROJECT_ID</code> are set
          in your <strong>mushi-identity-token</strong> edge function.{' '}
          {projectSlug && (
            <span>
              Then call <code>Mushi.identifyWithToken(token)</code> after sign-in in your app.
            </span>
          )}
        </Callout>
      )}

      {!isConfigured && !revealedSecret && (
        <Callout tone="neutral" label="Not configured">
          Without a signing secret, identity is anonymous — reports arrive without a verified
          user account. Generate a secret to enable account-linked reporting and{' '}
          <span className="font-medium">My Reports</span>.
        </Callout>
      )}
    </div>
  )
}
