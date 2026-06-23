/**
 * Langfuse-style "Not seeing what you expected?" FAQ block for quickstarts.
 */
'use client'

import { useId, useState } from 'react'

interface FaqItem {
  q: string
  a: string
}

const DEFAULT_FAQ: readonly FaqItem[] = [
  {
    q: 'The lime banner never appears in my store build',
    a: 'Capacitor and React Native bake NEXT_PUBLIC_MUSHI_* at compile time. Check Admin → Connect → Native app CI secrets, or run scripts/check-mushi-env.mjs in your native prebuild.',
  },
  {
    q: 'Reports return 401 or never show up',
    a: 'Confirm the project UUID and public ingest key match. Run mushi ping and Send test report on the Projects page. SDK keys are report:write scoped — not MCP keys.',
  },
  {
    q: 'MCP tools list is empty in Cursor',
    a: 'Restart the IDE after editing .cursor/mcp.json. Pass MUSHI_PROJECT_ID in env (no --project-id flag). Mint an MCP read or read+write key.',
  },
  {
    q: 'Widget shows but classification stays pending',
    a: 'BYOK: add Anthropic or OpenAI under Settings → API Keys. Self-host: confirm classify-report edge function is deployed and migrations are applied.',
  },
]

interface Props {
  items?: readonly FaqItem[]
}

export function TroubleshootingAccordion({ items = DEFAULT_FAQ }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const baseId = useId()

  return (
    <div className="not-prose border border-mushi-rule rounded-md divide-y divide-mushi-rule">
      <p className="px-4 py-3 m-0 font-semibold text-sm text-mushi-ink">Not seeing what you expected?</p>
      {items.map((item, i) => {
        const panelId = `${baseId}-panel-${i}`
        const isOpen = open === i
        return (
          <div key={item.q}>
            <button
              type="button"
              id={`${baseId}-trigger-${i}`}
              className="w-full text-left px-4 py-3 text-sm font-medium text-mushi-ink hover:bg-mushi-paper-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mushi-vermillion"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              {item.q}
            </button>
            {isOpen ? (
              <p id={panelId} role="region" aria-labelledby={`${baseId}-trigger-${i}`} className="px-4 pb-3 m-0 text-sm text-mushi-ink-muted">
                {item.a}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
