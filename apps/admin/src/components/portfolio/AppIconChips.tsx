/**
 * FILE: apps/admin/src/components/portfolio/AppIconChips.tsx
 * PURPOSE: Apps as a row of icons, never as comma text (2026-11-18; the owner on the Apps
 *          page: "you expect us to read a bunch of text wall?"). Each icon names its app in
 *          a tooltip and to screen readers; past `max` icons the rest fold into "+N".
 *          `CopyFixButton` is the one action a grouped row carries: its label is the verb
 *          ("Fix key", "Add probe") and clicking it copies the fix prompt.
 */

import { useEffect, useState } from 'react'
import type { ProjectFaviconSource } from '@mushi-mushi/core'
import { ProjectFavicon } from '../ProjectFavicon'
import { Btn } from '../ui'

/** An app's icon source by id (the page knows store icons, favicons and names). */
export type IconFor = (projectId: string) => ProjectFaviconSource

export function AppIconChips({
  projectIds,
  iconFor,
  titleFor,
  max = 8,
  size = 12,
}: {
  projectIds: readonly string[]
  iconFor: IconFor
  /** The tooltip per app; defaults to its name. */
  titleFor?: (projectId: string) => string
  max?: number
  size?: number
}) {
  const shown = projectIds.slice(0, max)
  const rest = projectIds.slice(max)
  const nameOf = (id: string) => iconFor(id).project_name
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-0.5" data-testid="app-icon-chips" data-count={projectIds.length}>
      {shown.map((id) => {
        const title = titleFor?.(id) ?? nameOf(id)
        return (
          <li key={id} className="inline-flex" title={title} data-app={id}>
            <ProjectFavicon {...iconFor(id)} size={size} />
            <span className="sr-only">{title}</span>
          </li>
        )
      })}
      {rest.length > 0 && (
        <li className="ml-0.5 font-mono text-2xs font-bold text-fg-secondary tabular-nums" title={rest.map((id) => titleFor?.(id) ?? nameOf(id)).join('\n')}>
          +{rest.length}
          <span className="sr-only"> more apps</span>
        </li>
      )}
    </ul>
  )
}

/** One verb that copies the fix prompt ("Fix key" → "Copied"). */
export function CopyFixButton({ label, prompt, apps }: { label: string; prompt: string; apps: number }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Btn
      size="sm"
      variant="ghost"
      className="whitespace-nowrap"
      title={`Copy the fix prompt for ${apps === 1 ? 'this app' : `all ${apps} apps`} into your editor`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(prompt)
          .then(() => setCopied(true))
          .catch(() => {
            /* Clipboard blocked (insecure context, denied): the label stays, so the user tries again. */
          })
      }}
    >
      {copied ? 'Copied ✓' : label}
    </Btn>
  )
}
