/**
 * Opt-in public page for the architecture diagram (Plan 020 §10.3.3).
 * The owner sees exactly what becomes public before publishing; a private
 * repo needs an explicit confirmation. The publish call echoes the preview's
 * hash, so a redraw in between is refused instead of publishing something
 * nobody reviewed.
 */

import { useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { publishToast, type DiagramPublication, type DiagramPublishPreview, type StaticPageStatus } from '../../lib/repoUnderstanding'
import { Btn, Card, Checkbox, CopyButton } from '../ui'

interface Props {
  projectId: string
  publication: DiagramPublication
  onChanged: () => void
}

export function ExploreDiagramPublishCard({ projectId, publication, onChanged }: Props) {
  const toast = useToast()
  const [preview, setPreview] = useState<DiagramPublishPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const base = `/v1/admin/projects/${projectId}/codebase/diagram`

  const loadPreview = async () => {
    setBusy(true)
    const res = await apiFetch<DiagramPublishPreview>(`${base}/publish-preview`, { cache: 'no-store' })
    setBusy(false)
    if (!res.ok || !res.data) {
      toast.error('Could not load the preview', res.error?.message)
      return
    }
    setConfirmed(false)
    setPreview(res.data)
  }

  const publish = async () => {
    if (!preview) return
    setBusy(true)
    const res = await apiFetchMutate<{ url: string; static_page?: StaticPageStatus }>(`${base}/publish`, {
      method: 'POST',
      body: JSON.stringify({
        diagram_id: preview.diagram_id,
        payload_hash: preview.payload_hash,
        confirm_private: preview.repo_private ? confirmed : undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      if (res.error?.code === 'STALE_PREVIEW') {
        toast.error('The diagram changed', 'Review the new preview, then publish.')
        void loadPreview()
        return
      }
      toast.error('Could not publish', res.error?.message)
      return
    }
    const t = publishToast(res.data?.static_page)
    if (t.tone === 'warn') toast.warn(t.title, t.description)
    else toast.success(t.title, t.description)
    setPreview(null)
    onChanged()
  }

  const unpublish = async () => {
    setBusy(true)
    const res = await apiFetchMutate<{ published: false }>(`${base}/publish`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      toast.error('Could not unpublish', res.error?.message)
      return
    }
    toast.success('Public page removed')
    onChanged()
  }

  return (
    <section data-testid="diagram-publish-card">
      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-fg">Public page</h3>
          {publication.published ? (
            <>
              <p className="text-xs text-fg-muted">
                Live at{' '}
                <a className="text-brand underline" href={publication.url} target="_blank" rel="noreferrer">
                  {publication.url}
                </a>{' '}
                · commit <span className="font-mono">{publication.commit_sha.slice(0, 7)}</span>
                {publication.outdated && ' · shows an older version of this diagram. Update it to show the latest one.'}
              </p>
              {publication.indexable === false && (
                <p className="text-xs text-fg-muted" data-testid="diagram-publish-not-indexed">
                  Search engines do not see this page yet: the page store is not set up, so the link opens the
                  interactive view. Publishing again after setup makes it indexable.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-fg-muted">
              Share this diagram on a public page. People see the part names, descriptions and file paths. They never see
              file contents.
            </p>
          )}
        </div>

        {publication.published && publication.badge_markdown && (
          <div className="space-y-1" data-testid="diagram-publish-badge">
            <div className="flex items-center gap-1.5 text-xs text-fg-secondary">
              Add a badge to your README
              <CopyButton value={publication.badge_markdown} label="Copy badge Markdown" />
            </div>
            <code className="block overflow-x-auto rounded-sm border border-edge-subtle bg-surface-overlay/40 px-2 py-1 font-mono text-2xs text-fg-muted">
              {publication.badge_markdown}
            </code>
            {publication.markdown_url && (
              <p className="text-xs text-fg-muted">
                Markdown copy for AI agents:{' '}
                <a className="text-brand underline" href={publication.markdown_url} target="_blank" rel="noreferrer">
                  {publication.markdown_url}
                </a>
              </p>
            )}
          </div>
        )}

        {!preview && (
          <div className="flex flex-wrap gap-2">
            {(!publication.published || publication.outdated) && (
              <Btn size="sm" variant="ghost" onClick={() => void loadPreview()} loading={busy}>
                {publication.published ? 'Update public page' : 'Preview public page'}
              </Btn>
            )}
            {publication.published && (
              <Btn size="sm" variant="danger" onClick={() => void unpublish()} loading={busy}>
                Unpublish
              </Btn>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-3" data-testid="diagram-publish-preview">
            <p className="text-xs text-fg-secondary">
              {preview.repo_private
                ? 'This repo is private on GitHub. Publishing makes everything below public.'
                : 'This repo is public on GitHub. This is exactly what the page will show.'}{' '}
              It will live at <span className="font-mono">{preview.url}</span> and show commit{' '}
              <span className="font-mono">{preview.payload.sha.slice(0, 7)}</span>.
            </p>
            {preview.payload.groups.length > 0 && (
              <p className="text-xs text-fg-secondary" data-testid="diagram-preview-groups">
                Groups: {preview.payload.groups.map((g) => g.label).join(' · ')}
              </p>
            )}
            <ul className="max-h-64 overflow-auto rounded-sm border border-edge-subtle divide-y divide-edge-subtle text-xs">
              {preview.payload.nodes.map((n) => (
                <li key={n.id} className="px-2.5 py-1.5">
                  <span className="font-medium text-fg">{n.label}</span>
                  {n.path && <span className="ml-2 font-mono text-fg-faint">{n.path}</span>}
                  {n.description && <div className="text-fg-muted">{n.description}</div>}
                </li>
              ))}
            </ul>
            {preview.payload.edges.some((e) => e.label) && (
              <details className="text-xs text-fg-secondary" data-testid="diagram-preview-edges">
                <summary className="cursor-pointer">Connection labels ({preview.payload.edges.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {preview.payload.edges.map((e) => {
                    const name = (id: string) => preview.payload.nodes.find((n) => n.id === id)?.label ?? id
                    return (
                      <li key={`${e.from}-${e.to}`}>
                        {name(e.from)} → {name(e.to)}
                        {e.label && <span className="text-fg-muted"> ({e.label})</span>}
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
            {preview.repo_private && (
              <Checkbox
                label="I understand these names, descriptions, paths and connection labels from a private repo become public."
                checked={confirmed}
                onChange={setConfirmed}
              />
            )}
            {!preview.can_publish && (
              <p className="text-xs text-warn">{preview.publish_blocked_reason ?? 'You cannot publish this diagram.'}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Btn
                size="sm"
                onClick={() => void publish()}
                loading={busy}
                disabled={!preview.can_publish || (preview.repo_private && !confirmed)}
              >
                Publish
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                Cancel
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
