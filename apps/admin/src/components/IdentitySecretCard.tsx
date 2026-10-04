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
import { describeActionError } from '../lib/actionError'
import { Btn, Callout, CodeValue } from './ui'
import { ConfirmDialog } from './ConfirmDialog'

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

const HOST_IDENTITY_HINTS: Record<
  string,
  { edgeFn: string; note: string }
> = {
  'yen-yen': {
    edgeFn: 'mushi-identity-token',
    note: 'Supabase → Edge Functions → mushi-identity-token → Secrets. Env MUSHI_IDENTITY_SECRET overrides private.mushi_identity_config.',
  },
  'glot-it': {
    edgeFn: 'glot-mushi-identity-token',
    note: 'Host: glot.it supabase/functions/glot-mushi-identity-token. Set MUSHI_IDENTITY_SECRET + MUSHI_PROJECT_ID edge secrets.',
  },
  'glot.it': {
    edgeFn: 'glot-mushi-identity-token',
    note: 'Host: glot.it supabase/functions/glot-mushi-identity-token. Set MUSHI_IDENTITY_SECRET + MUSHI_PROJECT_ID edge secrets.',
  },
  'the-wanting-mind': {
    edgeFn: 'mushi-identity-token',
    note: 'Verify edge function name under host supabase/functions/. Deploy with --no-verify-jwt.',
  },
  'help-her-take-photo': {
    edgeFn: 'mushi-identity-token',
    note: 'Verify edge function name under host supabase/functions/. Deploy with --no-verify-jwt.',
  },
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
  // Rotate and Disable both break every live identity token at once: confirm
  // with the themed dialog (QA bug 33; Disable used window.confirm, QA bug 260).
  const [confirming, setConfirming] = useState<'rotate' | 'disable' | null>(null)
  // A failed GET is not "Not configured" (QA bug 128): say what happened.
  const [loadError, setLoadError] = useState<string | null>(null)
  // Raw secret is only held in memory and cleared on unmount / page reload.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const revealedRef = useRef<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    void apiFetch<SecretStatus>(`/v1/admin/projects/${projectId}/identity-secret`)
      .then((res) => {
        if (res.ok && res.data) setStatus(res.data)
        else setLoadError(describeActionError(res.error, 'Could not check the signed-identity secret.'))
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
      toast.error('Could not generate the identity secret', describeActionError(res.error, 'Try again in a moment.'))
    }
  }, [projectId, toast])

  const remove = useCallback(async () => {
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
      toast.error('Could not disable signed identity', describeActionError(res.error, 'Try again in a moment.'))
    }
  }, [projectId, toast])

  if (loading) {
    return <div className="text-2xs text-fg-faint px-1 py-2">Loading identity secret…</div>
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium text-fg">Signed identity</div>
        <Callout tone="warn" label="Could not check this setting">
          {loadError}
        </Callout>
        <Btn size="sm" variant="ghost" onClick={load}>
          Retry
        </Btn>
      </div>
    )
  }

  const envBlock = revealedSecret
    ? `MUSHI_IDENTITY_SECRET="${revealedSecret}"\nMUSHI_PROJECT_ID="${projectId}"`
    : null

  const isConfigured = status?.configured ?? false
  const hostHint =
    (projectSlug && HOST_IDENTITY_HINTS[projectSlug]) ||
    HOST_IDENTITY_HINTS[projectSlug?.replace(/\./g, '-') ?? ''] ||
    null

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
            // Rotating replaces a live secret: confirm first. A first secret breaks nothing.
            onClick={isConfigured ? () => setConfirming('rotate') : generate}
          >
            {isConfigured ? 'Rotate secret' : 'Generate secret'}
          </Btn>
          {isConfigured && (
            <Btn size="sm" variant="danger" loading={deleting} onClick={() => setConfirming('disable')}>
              Disable
            </Btn>
          )}
        </div>
      </div>

      {confirming === 'rotate' && (
        <ConfirmDialog
          title="Rotate the signed-identity secret?"
          body={
            'The current secret stops verifying immediately. Every end-user token your app already minted fails, ' +
            'so reports arrive without a verified account until you set the new secret on your host function and redeploy.'
          }
          confirmLabel="Rotate secret"
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            void generate()
          }}
        />
      )}
      {confirming === 'disable' && (
        <ConfirmDialog
          title="Disable signed identity?"
          body="All existing tokens stop verifying immediately and new reports arrive anonymous. You can generate a new secret later."
          confirmLabel="Disable"
          tone="danger"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            void remove()
          }}
        />
      )}

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
          Set <code>MUSHI_IDENTITY_SECRET</code> and <code>MUSHI_PROJECT_ID</code> on your host
          edge function
          {hostHint ? (
            <>
              {' '}
              <strong>{hostHint.edgeFn}</strong>. {hostHint.note}
            </>
          ) : (
            <> (see host repo supabase/functions).</>
          )}{' '}
          Then call <code>identifyWithToken()</code> after sign-in. Operator script:{' '}
          <code>scripts/sync-host-identity-secret.mjs --project {projectId}</code>
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
