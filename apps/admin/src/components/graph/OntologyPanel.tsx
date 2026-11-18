import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { apiErrorMessage } from '../../lib/humanizeApiError'
import { Card, Btn, ErrorAlert, Input } from '../ui'
import { TableSkeleton } from '../skeletons/TableSkeleton'

interface OntologyTag {
  tag: string
  parent_tag: string | null
  description: string | null
  usage_count: number
}

export function OntologyPanel() {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<{ tags: OntologyTag[] }>('/v1/admin/ontology')
  const [adding, setAdding] = useState(false)
  const [tag, setTag] = useState('')
  const [parentTag, setParentTag] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const tags = data?.tags ?? []
  const roots = tags.filter((t) => !t.parent_tag)
  const childrenOf = (parent: string) => tags.filter((t) => t.parent_tag === parent)

  async function submit() {
    if (!tag.trim()) {
      toast.push({ tone: 'error', message: 'Tag name required' })
      return
    }
    setSaving(true)
    const res = await apiFetch('/v1/admin/ontology', {
      method: 'POST',
      body: JSON.stringify({
        tag: tag.trim(),
        parentTag: parentTag.trim() || undefined,
        description: description.trim() || undefined,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast.push({ tone: 'success', message: `Added "${tag}" to ontology` })
      setTag('')
      setParentTag('')
      setDescription('')
      setAdding(false)
      reload()
    } else {
      toast.push({
        tone: 'error',
        message:
          res.error?.code === 'DUPLICATE_TAG'
            ? `"${tag.trim()}" is already in the ontology.`
            : apiErrorMessage(res.error, 'Could not add the tag. Try again.'),
      })
    }
  }

  return (
    <Card elevated className="p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-fg-secondary">Bug ontology</h3>
          <p className="text-2xs text-fg-faint">
            Project-specific tags the LLM can apply to reports during Stage 2 classification.
          </p>
        </div>
        <Btn size="sm" variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding((v) => !v)} className="shrink-0 whitespace-nowrap">
          {adding ? 'Cancel' : 'Add tag'}
        </Btn>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 border border-edge-subtle rounded-sm p-2 bg-surface-overlay">
          <Input
            label="Tag"
            placeholder="payment-flow"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
          <Input
            label="Parent tag (optional)"
            placeholder="checkout"
            value={parentTag}
            onChange={(e) => setParentTag(e.target.value)}
          />
          <Input
            label="Description (optional)"
            placeholder="Issues that occur during the payment confirmation step"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex justify-end">
            <Btn size="sm" onClick={submit} disabled={saving} loading={saving}>
              Add to ontology
            </Btn>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} columns={3} showFilters={false} label="Loading ontology" />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : tags.length === 0 ? (
        <p className="text-2xs text-fg-muted">No tags yet. Examples: payment-flow, onboarding-step-3, dark-mode.</p>
      ) : (
        <ul className="text-2xs space-y-1 max-h-72 overflow-y-auto pr-1">
          {roots.map((root) => (
            <li key={root.tag}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-fg-secondary">{root.tag}</span>
                <span className="text-fg-faint tabular-nums whitespace-nowrap">{usesLabel(root.usage_count)}</span>
              </div>
              {root.description && (
                <div className="text-fg-faint pl-2">{root.description}</div>
              )}
              {childrenOf(root.tag).map((child) => (
                <div key={child.tag} className="pl-3 mt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-fg-muted">↳ {child.tag}</span>
                    <span className="text-fg-faint tabular-nums whitespace-nowrap">{usesLabel(child.usage_count)}</span>
                  </div>
                  {child.description && (
                    <div className="text-fg-faint pl-3">{child.description}</div>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** "x211" had no unit: the count is how many reports carry the tag. @internal Exported for tests. */
export function usesLabel(n: number): string {
  return `${n.toLocaleString()} report${n === 1 ? '' : 's'}`
}
