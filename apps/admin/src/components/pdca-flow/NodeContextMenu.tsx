/**
 * FILE: apps/admin/src/components/pdca-flow/NodeContextMenu.tsx
 * PURPOSE: Right-click menu anchored to a PDCA node. Surfaces the power-
 *          user actions the hover toolbar hides — "open full page",
 *          "copy stage id", "focus in log" — without cluttering the node
 *          body. Intentionally tiny (≤ 4 items) to respect Hick's law.
 */
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PdcaNodeData } from './pdcaFlow.data'
import { PDCA_STAGES } from '../../lib/pdca'

interface NodeContextMenuProps {
  x: number
  y: number
  node: PdcaNodeData
  onClose: () => void
  onInspect: () => void
  onFocusLog: () => void
}

export function NodeContextMenu({ x, y, node, onClose, onInspect, onFocusLog }: NodeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const meta = PDCA_STAGES[node.stageId]
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      if (!ref.current) return
      if (ref.current.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      window.addEventListener('click', onClick)
      window.addEventListener('contextmenu', onClick)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onClick)
    }
  }, [onClose])

  const items = [
    {
      label: `Inspect ${meta.label}`,
      hint: 'Open drawer',
      onClick: () => {
        onInspect()
        onClose()
      },
    },
    {
      label: 'Open full page',
      hint: node.href,
      onClick: () => {
        navigate(node.href)
        onClose()
      },
    },
    {
      label: 'Focus in activity log',
      hint: 'Highlight recent events',
      onClick: () => {
        onFocusLog()
        onClose()
      },
    },
    {
      label: 'Copy stage id',
      hint: node.stageId,
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(node.stageId)
        } catch {
          // clipboard may be unavailable (iframe, HTTP); silently ignore
        }
        onClose()
      },
    },
  ]

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${meta.label} actions`}
      className="pointer-events-auto absolute z-30 min-w-[10rem] rounded-md border border-edge/70 bg-surface-overlay/95 p-0.5 shadow-card backdrop-blur-sm motion-safe:animate-mushi-fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.onClick}
          className="w-full text-left rounded-sm px-2 py-1 text-xs text-fg hover:bg-surface-raised focus-visible:outline-none focus-visible:bg-surface-raised flex flex-col gap-0"
        >
          <span>{item.label}</span>
          <span className="text-3xs text-fg-faint truncate">{item.hint}</span>
        </button>
      ))}
    </div>
  )
}
