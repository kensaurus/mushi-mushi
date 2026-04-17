'use client'

import { useState } from 'react'

const REPO = 'kensaurus/mushi-mushi'
const BRANCH = 'master'

export interface PlaygroundProps {
  /**
   * Folder under `apps/docs/playground/` containing a runnable StackBlitz
   * project (must have a `package.json`). The component builds a
   * `stackblitz.com/github/...` embed URL from this.
   */
  scenario: string
  /** File to open in the editor pane on first load. */
  file?: string
  /** Optional preview-only height. Default 520px. */
  height?: number
  /** Hide the file-tree explorer. Default true (compact embed). */
  hideExplorer?: boolean
  /** Optional title shown above the embed. */
  title?: string
}

const buildEmbedUrl = ({
  scenario,
  file,
  hideExplorer = true,
}: Pick<PlaygroundProps, 'scenario' | 'file' | 'hideExplorer'>) => {
  const params = new URLSearchParams({
    embed: '1',
    theme: 'dark',
    view: 'preview',
    hideNavigation: '1',
    hideExplorer: hideExplorer ? '1' : '0',
  })
  if (file) params.set('file', file)
  return `https://stackblitz.com/github/${REPO}/tree/${BRANCH}/apps/docs/playground/${scenario}?${params.toString()}`
}

export const Playground = ({
  scenario,
  file,
  height = 520,
  hideExplorer = true,
  title,
}: PlaygroundProps) => {
  const [loaded, setLoaded] = useState(false)
  const url = buildEmbedUrl({ scenario, file, hideExplorer })

  return (
    <figure className="my-6 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <figcaption className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
        <span>
          Live playground{title ? ` — ${title}` : ''}
        </span>
        <a
          href={url.replace('embed=1&', '').replace('?embed=1', '')}
          target="_blank"
          rel="noreferrer noopener"
          className="text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300"
        >
          Open in StackBlitz ↗
        </a>
      </figcaption>

      <div
        className="relative w-full bg-neutral-100 dark:bg-neutral-900"
        style={{ height }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
            Booting WebContainer…
          </div>
        )}
        <iframe
          src={url}
          title={`Playground — ${scenario}`}
          loading="lazy"
          allow="cross-origin-isolated; clipboard-write"
          sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-storage-access-by-user-activation"
          className="absolute inset-0 h-full w-full"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </figure>
  )
}
