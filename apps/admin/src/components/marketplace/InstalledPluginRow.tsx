/**
 * FILE: apps/admin/src/components/marketplace/InstalledPluginRow.tsx
 * PURPOSE: Full lifecycle controls for a single installed plugin row —
 *   Send test event, Pause / Resume, Edit webhook URL, Rotate signing
 *   secret, and Uninstall.  Rendered by InstalledList.
 */

import { useState } from 'react'
import { Badge, Btn, Card, Input } from '../ui'
import {
  IconPlay,
  IconPencil,
  IconKey,
  IconTrash,
  IconPause,
  IconCheck,
  IconClose,
} from '../icons'
import { STATUS_CHIP, pluginWebhookUrlError, type InstalledPlugin } from './types'
import { ConfirmDialog } from '../ConfirmDialog'
import { ADMIN_ONLY_HINT } from '../../lib/orgPermissions'

export interface InstalledPluginRowProps {
  plugin: InstalledPlugin
  busy: boolean
  onTest: (slug: string) => Promise<void>
  onTogglePause: (slug: string, active: boolean) => Promise<void>
  onEditUrl: (slug: string, newUrl: string) => Promise<void>
  onRotateSecret: (slug: string) => Promise<string>
  onUninstall: (slug: string, name: string) => void
  /** False for members and viewers: every write here is owner/admin only. */
  canManage?: boolean
}

type ViewState = 'idle' | 'editing-url' | 'rotated'

export function InstalledPluginRow({
  plugin,
  busy,
  onTest,
  onTogglePause,
  onEditUrl,
  onRotateSecret,
  onUninstall,
  canManage = true,
}: InstalledPluginRowProps) {
  const slug = plugin.plugin_slug ?? plugin.plugin_name
  const [view, setView] = useState<ViewState>('idle')
  const [editUrl, setEditUrl] = useState(plugin.webhook_url ?? '')
  const [savingUrl, setSavingUrl] = useState(false)
  const [rotatingSecret, setRotatingSecret] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [urlError, setUrlError] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)

  // A non-https URL used to make Save do nothing at all. Say why instead.
  const handleSaveUrl = async () => {
    const problem = pluginWebhookUrlError(editUrl)
    if (problem) {
      setUrlError(problem)
      return
    }
    setUrlError(null)
    setSavingUrl(true)
    try {
      await onEditUrl(slug, editUrl.trim())
      setView('idle')
    } catch {
      // The page already toasted why; keep the editor open to fix it.
    } finally {
      setSavingUrl(false)
    }
  }

  const handleRotate = async () => {
    setRotatingSecret(true)
    try {
      const secret = await onRotateSecret(slug)
      setNewSecret(secret)
      setView('rotated')
    } catch {
      // The page already toasted why; the old secret is still in place.
    } finally {
      setRotatingSecret(false)
      setConfirmRotate(false)
    }
  }

  const copySecret = () => {
    if (!newSecret) return
    navigator.clipboard.writeText(newSecret).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold">{plugin.plugin_name}</p>
            {!plugin.is_active && (
              <Badge className="bg-fg-muted/10 text-fg-muted text-3xs">Paused</Badge>
            )}
          </div>
          <p className="text-2xs text-fg-muted font-mono truncate">
            {plugin.webhook_url ?? '(built-in)'}
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {plugin.subscribed_events?.length === 0 ? (
              <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">all events</code>
            ) : (
              plugin.subscribed_events?.map((e) => (
                <code key={e} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
                  {e}
                </code>
              ))
            )}
          </div>
        </div>

        {/* Status chip + last delivery */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {plugin.last_delivery_status ? (
            <span
              className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[plugin.last_delivery_status]}`}
            >
              {plugin.last_delivery_status.toUpperCase()}
            </span>
          ) : null}
          {plugin.last_delivery_at ? (
            <span className="text-2xs text-fg-muted">
              {new Date(plugin.last_delivery_at).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>

      {/* Edit URL panel */}
      {view === 'editing-url' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Input
              placeholder="https://…"
              value={editUrl}
              onChange={(e) => {
                setEditUrl(e.target.value)
                if (urlError) setUrlError(null)
              }}
              error={urlError ?? undefined}
              className="text-xs"
              aria-label="Webhook URL"
            />
          </div>
          <Btn size="sm" variant="ghost" disabled={savingUrl} onClick={handleSaveUrl}>
            {savingUrl ? 'Saving…' : 'Save'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setView('idle')}>
            Cancel
          </Btn>
        </div>
      )}

      {/* New-secret panel (shown once after rotate) */}
      {view === 'rotated' && newSecret && (
        <div className="flex items-center gap-2 bg-surface-raised rounded p-2">
          <code className="flex-1 font-mono text-2xs text-fg-muted break-all">{newSecret}</code>
          <Btn
            size="sm"
            variant="ghost"
            leadingIcon={<IconCheck size={12} className={copied ? 'text-ok' : undefined} />}
            onClick={copySecret}
          >
            {copied ? 'Copied' : 'Copy'}
          </Btn>
          <Btn
            size="sm"
            variant="cancel"
            leadingIcon={<IconClose size={12} />}
            onClick={() => setView('idle')}
          >
            Dismiss
          </Btn>
        </div>
      )}

      {/* Action bar */}
      {view === 'idle' && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Btn
            size="sm"
            variant="ghost"
            title={canManage ? 'Send test event' : ADMIN_ONLY_HINT}
            disabled={busy || !plugin.webhook_url || !canManage}
            leadingIcon={<IconPlay size={12} />}
            onClick={() => void onTest(slug)}
          >
            Test
          </Btn>

          <Btn
            size="sm"
            variant="ghost"
            title={!canManage ? ADMIN_ONLY_HINT : plugin.is_active ? 'Pause deliveries' : 'Resume deliveries'}
            disabled={busy || !canManage}
            leadingIcon={
              plugin.is_active ? <IconPause size={12} /> : <IconPlay size={12} />
            }
            onClick={() => void onTogglePause(slug, plugin.is_active)}
          >
            {plugin.is_active ? 'Pause' : 'Resume'}
          </Btn>

          <Btn
            size="sm"
            variant="ghost"
            title={canManage ? 'Edit webhook URL' : ADMIN_ONLY_HINT}
            disabled={busy || !canManage}
            leadingIcon={<IconPencil size={12} />}
            onClick={() => {
              setEditUrl(plugin.webhook_url ?? '')
              setView('editing-url')
            }}
          >
            Edit URL
          </Btn>

          <Btn
            size="sm"
            variant="ghost"
            title={canManage ? 'Rotate signing secret' : ADMIN_ONLY_HINT}
            disabled={busy || rotatingSecret || !canManage}
            leadingIcon={<IconKey size={12} />}
            onClick={() => setConfirmRotate(true)}
          >
            {rotatingSecret ? 'Rotating…' : 'Rotate secret'}
          </Btn>

          <Btn
            size="sm"
            variant="danger"
            title={canManage ? 'Uninstall plugin' : ADMIN_ONLY_HINT}
            disabled={busy || !canManage}
            leadingIcon={<IconTrash size={12} />}
            onClick={() => onUninstall(slug, plugin.plugin_name)}
          >
            Uninstall
          </Btn>
        </div>
      )}

      {confirmRotate && (
        <ConfirmDialog
          title={`Rotate the signing secret for ${plugin.plugin_name}?`}
          body="Your receiver rejects deliveries signed with the new secret until you update it there. The new secret is shown only once."
          confirmLabel="Rotate secret"
          cancelLabel="Keep current secret"
          tone="danger"
          loading={rotatingSecret}
          onConfirm={() => void handleRotate()}
          onCancel={() => {
            if (!rotatingSecret) setConfirmRotate(false)
          }}
        />
      )}
    </Card>
  )
}
