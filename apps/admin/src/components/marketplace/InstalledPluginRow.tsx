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
import { STATUS_CHIP, type InstalledPlugin } from './types'

export interface InstalledPluginRowProps {
  plugin: InstalledPlugin
  busy: boolean
  onTest: (slug: string) => Promise<void>
  onTogglePause: (slug: string, active: boolean) => Promise<void>
  onEditUrl: (slug: string, newUrl: string) => Promise<void>
  onRotateSecret: (slug: string) => Promise<string>
  onUninstall: (slug: string, name: string) => void
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
}: InstalledPluginRowProps) {
  const slug = plugin.plugin_slug ?? plugin.plugin_name
  const [view, setView] = useState<ViewState>('idle')
  const [editUrl, setEditUrl] = useState(plugin.webhook_url ?? '')
  const [savingUrl, setSavingUrl] = useState(false)
  const [rotatingSecret, setRotatingSecret] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSaveUrl = async () => {
    if (!editUrl.startsWith('https://')) return
    setSavingUrl(true)
    try {
      await onEditUrl(slug, editUrl)
      setView('idle')
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
    } finally {
      setRotatingSecret(false)
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
          <Input
            placeholder="https://…"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            className="flex-1 text-xs"
          />
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
            variant="ghost"
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
            title="Send test event"
            disabled={busy || !plugin.webhook_url}
            leadingIcon={<IconPlay size={12} />}
            onClick={() => void onTest(slug)}
          >
            Test
          </Btn>

          <Btn
            size="sm"
            variant="ghost"
            title={plugin.is_active ? 'Pause deliveries' : 'Resume deliveries'}
            disabled={busy}
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
            title="Edit webhook URL"
            disabled={busy}
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
            title="Rotate signing secret"
            disabled={busy || rotatingSecret}
            leadingIcon={<IconKey size={12} />}
            onClick={handleRotate}
          >
            {rotatingSecret ? 'Rotating…' : 'Rotate secret'}
          </Btn>

          <Btn
            size="sm"
            variant="danger"
            title="Uninstall plugin"
            disabled={busy}
            leadingIcon={<IconTrash size={12} />}
            onClick={() => onUninstall(slug, plugin.plugin_name)}
          >
            Uninstall
          </Btn>
        </div>
      )}
    </Card>
  )
}
