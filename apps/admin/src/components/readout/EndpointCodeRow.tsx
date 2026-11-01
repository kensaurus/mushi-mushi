/**
 * FILE: EndpointCodeRow.tsx
 * PURPOSE: Copyable URL/code row with host subtitle — Connect-style endpoint readout.
 */

import { CopyButton } from '../ui'

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url
  }
}

export function EndpointCodeRow({ label, url }: { label: string; url: string }) {
  return (
    // One frame per row: the border groups label + value + host, so the URL
    // is plain mono text rather than a second (formerly terminal-black) chip
    // nested inside a tinted box.
    <div className="rounded-md border border-edge-subtle px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint">{label}</span>
        <CopyButton value={url} label={`Copy ${label}`} copiedLabel="Copied" size="sm" />
      </div>
      <p className="font-mono text-2xs leading-relaxed text-fg break-all">{url}</p>
      <p className="mt-0.5 font-mono text-3xs text-fg-faint">{hostFromUrl(url)}</p>
    </div>
  )
}
