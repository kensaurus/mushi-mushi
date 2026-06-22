/**
 * FILE: EndpointCodeRow.tsx
 * PURPOSE: Copyable URL/code row with host subtitle — Connect-style endpoint readout.
 */

import { CopyButton } from '../ui'
import { CodeInline } from '../CodePanel'

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url
  }
}

export function EndpointCodeRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-root/40 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</span>
        <CopyButton value={url} label={`Copy ${label}`} copiedLabel="Copied" size="sm" />
      </div>
      <CodeInline className="block break-all whitespace-normal text-fg-secondary">{url}</CodeInline>
      <p className="mt-1 font-mono text-3xs text-fg-faint">{hostFromUrl(url)}</p>
    </div>
  )
}
