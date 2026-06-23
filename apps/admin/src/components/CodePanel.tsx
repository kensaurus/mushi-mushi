/**
 * Shared framed code surface for install snippets, env values, and IDs.
 */

import type { ReactNode } from 'react'
import { CopyButton } from './ui'
import { CODE_TOKEN_CLASS, tokenizeSnippet } from '../lib/highlightSnippet'

export interface CodePanelProps {
  label: string
  language: string
  code: string
  onCopy: () => void
  copied: boolean
  maxHeight?: string
}

export function CodePanel({ label, language, code, onCopy, copied, maxHeight }: CodePanelProps) {
  const tokens = tokenizeSnippet(code, language)

  return (
    <div className="mushi-code-block rounded-md border border-code-surface-border overflow-hidden">
      <div className="mushi-code-toolbar flex items-center justify-between gap-2 px-3 py-1.5 border-b border-code-surface-border">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="mushi-code-glyph font-mono text-2xs leading-none select-none">
            {'</>'}
          </span>
          <span className="text-2xs uppercase tracking-wider font-medium text-code-surface-fg-muted truncate">
            {label}
          </span>
          <span className="mushi-code-lang text-3xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border">
            {language}
          </span>
        </div>
        <CopyButton
          onCopy={onCopy}
          copied={copied}
          label={`Copy ${label.toLowerCase()} snippet`}
          copiedLabel={`${label} snippet copied`}
          className="shrink-0 text-code-surface-fg-muted hover:text-code-surface-fg hover:bg-white/10 focus-visible:ring-code-surface-fg-muted/40"
        />
      </div>
      <pre
        className={`mushi-code-body px-3 py-2.5 font-mono overflow-x-auto whitespace-pre-wrap ${maxHeight ? `${maxHeight} overflow-y-auto` : ''}`.trim()}
      >
        <code>
          {tokens.map((token, index) => (
            <span key={`${index}-${token.kind}`} className={CODE_TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

/** Inline monospace chip for UUIDs, hosts, key prefixes, env var names. */
export function CodeInline({
  children,
  title,
  className = '',
}: {
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <code
      title={title}
      className={`mushi-code-inline max-w-full font-mono text-2xs tabular-nums ${className}`.trim()}
    >
      {children}
    </code>
  )
}
