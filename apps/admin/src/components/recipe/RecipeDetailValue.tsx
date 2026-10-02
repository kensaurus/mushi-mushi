/**
 * FILE: apps/admin/src/components/recipe/RecipeDetailValue.tsx
 * PURPOSE: Generic, readable renderer for `RecipeElementDetail.detail` — an
 *          element-specific object whose shape the server documents per
 *          element. Objects become key/value lists, arrays become bullet lists,
 *          scalars become text. Strings are shown as text, never as links or
 *          HTML (they can originate in a host repo).
 */

import { humanizeKey } from './recipeState'

const MAX_DEPTH = 4
const MAX_ITEMS = 50

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function scalarText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString() : String(v)
  if (typeof v === 'string') return v
  return String(v)
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)
}

export function RecipeDetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isScalar(value)) {
    return <span className="wrap-break-word text-fg">{scalarText(value)}</span>
  }

  if (depth >= MAX_DEPTH) {
    return (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs text-fg-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-muted">None</span>
    const shown = value.slice(0, MAX_ITEMS)
    const more = value.length - shown.length
    if (shown.every(isScalar)) {
      return (
        <ul className="flex flex-wrap gap-1">
          {shown.map((item, i) => (
            <li key={i} className="font-mono text-2xs text-fg-secondary">
              {scalarText(item)}
              {i < shown.length - 1 ? ',' : ''}
            </li>
          ))}
          {more > 0 && <li className="text-2xs text-fg-faint">+{more.toLocaleString()} more</li>}
        </ul>
      )
    }
    return (
      <ul className="flex flex-col gap-1.5">
        {shown.map((item, i) => (
          <li key={i} className="border-l-2 border-edge-subtle pl-2">
            <RecipeDetailValue value={item} depth={depth + 1} />
          </li>
        ))}
        {more > 0 && <li className="text-2xs text-fg-faint">+{more.toLocaleString()} more</li>}
      </ul>
    )
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return <span className="text-fg-muted">Nothing reported</span>
    return (
      <dl className="flex flex-col gap-1">
        {entries.map(([k, v]) => {
          const nested = !isScalar(v)
          return (
            <div key={k} className={nested ? 'flex flex-col gap-0.5' : 'flex items-baseline justify-between gap-3'}>
              <dt className="shrink-0 text-2xs font-medium text-fg-faint">{humanizeKey(k)}</dt>
              <dd className={`min-w-0 text-2xs ${nested ? 'pl-2' : 'text-right'}`}>
                <RecipeDetailValue value={v} depth={depth + 1} />
              </dd>
            </div>
          )
        })}
      </dl>
    )
  }

  return <span className="text-fg-muted">{scalarText(value)}</span>
}
