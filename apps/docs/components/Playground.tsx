/** StackBlitz embed with a click-to-launch card as the default state. */
'use client'

import { useState } from 'react'

const REPO   = 'kensaurus/mushi-mushi'
const BRANCH = 'master'

export interface PlaygroundProps {
  /**
   * Folder under `apps/docs/playground/` containing a runnable StackBlitz
   * project (must have a `package.json`).
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

function buildEmbedUrl({ scenario, file, hideExplorer = true }: Pick<PlaygroundProps, 'scenario' | 'file' | 'hideExplorer'>) {
  const p = new URLSearchParams({
    embed: '1',
    theme: 'dark',
    view: 'preview',
    hideNavigation: '1',
    hideExplorer: hideExplorer ? '1' : '0',
  })
  if (file) p.set('file', file)
  return `https://stackblitz.com/github/${REPO}/tree/${BRANCH}/apps/docs/playground/${scenario}?${p.toString()}`
}

function buildOpenUrl({ scenario, file }: Pick<PlaygroundProps, 'scenario' | 'file'>) {
  const p = new URLSearchParams({ theme: 'dark' })
  if (file) p.set('file', file)
  return `https://stackblitz.com/github/${REPO}/tree/${BRANCH}/apps/docs/playground/${scenario}?${p.toString()}`
}

export const Playground = ({
  scenario,
  file,
  height = 520,
  hideExplorer = true,
  title,
}: PlaygroundProps) => {
  const [launched, setLaunched] = useState(false)
  const [loaded, setLoaded]     = useState(false)

  const embedUrl = buildEmbedUrl({ scenario, file, hideExplorer })
  const openUrl  = buildOpenUrl({ scenario, file })

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border border-[color:var(--nextra-border,#e5e7eb)] bg-[color:var(--nextra-bg,white)]">

      {/* ── Top bar ── */}
      <figcaption className="flex items-center justify-between border-b border-[color:var(--nextra-border,#e5e7eb)] px-4 py-2.5 text-xs">
        <span style={{ fontFamily: 'monospace', letterSpacing: '0.04em', opacity: 0.55 }}>
          {title ? `Live playground — ${title}` : 'Live playground'}
        </span>
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: 'var(--mushi-vermillion, #e03c2c)', fontFamily: 'monospace', letterSpacing: '0.04em' }}
          className="hover:underline underline-offset-2"
        >
          Open in StackBlitz ↗
        </a>
      </figcaption>

      {/* ── Content area ── */}
      <div className="relative w-full bg-[color:var(--nextra-bg,white)]" style={{ height }}>

        {/* Default: launch card */}
        {!launched && (
          <button
            type="button"
            onClick={() => setLaunched(true)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-colors hover:bg-[color-mix(in_oklch,var(--mushi-vermillion,#e03c2c)_5%,white)]"
            aria-label="Launch live playground"
          >
            {/* Play button */}
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--mushi-vermillion, #e03c2c)',
                boxShadow: '0 4px 24px -6px color-mix(in oklch, var(--mushi-vermillion, #e03c2c) 55%, transparent)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M5.5 3.5L14.5 9L5.5 14.5V3.5Z" fill="white" />
              </svg>
            </span>

            <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.55 }}>
              Launch playground
            </span>

            <span style={{ fontSize: '0.7rem', opacity: 0.35 }}>
              Powered by StackBlitz WebContainers
            </span>
          </button>
        )}

        {/* After launch: iframe with loading overlay */}
        {launched && (
          <>
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ opacity: 0.5 }}>
                Booting WebContainer…
              </div>
            )}
            <iframe
              src={embedUrl}
              title={`Playground — ${scenario}`}
              loading="eager"
              allow="cross-origin-isolated; clipboard-write"
              sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-storage-access-by-user-activation"
              className="absolute inset-0 h-full w-full"
              onLoad={() => setLoaded(true)}
            />
          </>
        )}
      </div>
    </figure>
  )
}
