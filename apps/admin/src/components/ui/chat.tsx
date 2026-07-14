/**
 * FILE: chat.tsx
 * PURPOSE: Opaque chat/workbench primitives for atlas Ask + sidebar replies.
 *
 * OVERVIEW:
 * - ChatTurnShell — header strip + body without semi-transparent Card stacking
 * - ChatThreadList / ChatThreadItem — contained thread rail
 * - ChatScrollRegion — bordered scroll surface for message history
 */

import type { ReactNode } from 'react'

const TURN_HEADER = {
  user: 'border-brand/20 bg-brand/12 text-brand border border-brand/28',
  assistant: 'border-edge-subtle bg-surface-overlay text-fg-faint',
} as const

const TURN_SHELL = {
  user: 'border-brand/25 bg-surface-raised',
  assistant: 'border-edge-subtle bg-surface-raised',
} as const

interface ChatTurnShellProps {
  role: 'user' | 'assistant'
  label?: string
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  streaming?: boolean
}

/** Single chat turn — opaque surfaces so tints never bleed through the shell. */
export function ChatTurnShell({
  role,
  label,
  actions,
  footer,
  children,
  className = '',
  streaming,
}: ChatTurnShellProps) {
  const isUser = role === 'user'
  return (
    <article
      className={`group/turn overflow-hidden rounded-md border shadow-card ${TURN_SHELL[role]} ${className}`}
    >
      <header
        className={`flex items-center justify-between gap-2 border-b px-3 py-1.5 text-3xs font-medium uppercase tracking-wider ${TURN_HEADER[role]}`}
      >
        <span>{label ?? (isUser ? 'You' : 'Answer')}{streaming ? ' …' : ''}</span>
        {actions}
      </header>
      <div className="min-w-0 px-3 py-2.5">{children}</div>
      {footer}
    </article>
  )
}

/** Opaque bordered rail for past chat threads. */
export function ChatThreadList({
  children,
  className = '',
  header,
}: {
  children: ReactNode
  className?: string
  header?: ReactNode
}) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`}>
      {header}
      <div
        className="flex min-h-[8rem] flex-1 flex-col overflow-hidden rounded-md border border-edge-subtle bg-surface-raised shadow-card xl:max-h-none max-h-[min(40vh,320px)]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">{children}</div>
      </div>
    </div>
  )
}

interface ChatThreadItemProps {
  active?: boolean
  onClick?: () => void
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}

export function ChatThreadItem({
  active,
  onClick,
  title,
  meta,
  actions,
  className = '',
}: ChatThreadItemProps) {
  return (
    <div
      className={`group/thread relative overflow-hidden rounded-sm border transition-[border-color,background-color,box-shadow] motion-safe:duration-150 ${
        active
          ? 'border-brand/30 bg-surface-overlay shadow-sm ring-1 ring-inset ring-brand/15'
          : 'border-transparent bg-transparent hover:border-edge-subtle hover:bg-surface-overlay'
      } ${className}`}
    >
      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand"
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-sm px-2.5 py-2 pr-14 text-2xs text-fg-secondary"
      >
        <span className="line-clamp-2 font-medium text-fg">{title}</span>
        {meta ? <span className="mt-0.5 block text-3xs text-fg-faint tabular-nums">{meta}</span> : null}
      </button>
      {actions}
    </div>
  )
}

interface ChatScrollRegionProps {
  children: ReactNode
  className?: string
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

/** Main message history — contained scroll surface (prevents background bleed). */
export function ChatScrollRegion({ children, className = '', scrollRef }: ChatScrollRegionProps) {
  return (
    <div
      ref={scrollRef}
      className={`min-h-0 flex-1 overflow-y-auto rounded-md border border-edge-subtle bg-surface-raised p-2 shadow-card max-h-[min(58dvh,640px)] xl:max-h-none ${className}`}
    >
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

interface ChatComposerProps {
  children: ReactNode
  className?: string
}

/** Pinned composer row below the scroll region. */
export function ChatComposer({ children, className = '' }: ChatComposerProps) {
  return (
    <div
      className={`rounded-md border border-edge-subtle bg-surface-raised p-2 shadow-card ${className}`}
    >
      {children}
    </div>
  )
}
