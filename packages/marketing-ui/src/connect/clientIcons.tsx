/**
 * FILE: connect/clientIcons.tsx
 * PURPOSE: Shared 16×16 SVG glyphs for MCP client chips on Connect surfaces.
 *
 * OVERVIEW:
 * - Single source for admin ConnectStudio and public docs /connect.
 * - Stroke-based, currentColor — matches editorial connect chip styling.
 *
 * USAGE:
 *   import { ConnectClientIcon } from '@mushi-mushi/marketing-ui'
 *   <ConnectClientIcon id="cursor" size={16} />
 */

import type { ReactNode } from 'react'
import type { McpClientId } from '@mushi-mushi/mcp/clients'

interface IconProps {
  size?: number
  className?: string
}

function wrap({ size = 16, className }: IconProps, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function IconCursor(p: IconProps) {
  return wrap(p, (
    <path d="M4 2 L4 14 L7.5 10.5 L10 14 L11.5 13 L9 9 L13 9 Z" fill="currentColor" stroke="none" />
  ))
}

function IconVSCode(p: IconProps) {
  return wrap(p, (
    <>
      <polyline points="9,3 4,8 9,13" strokeWidth="1.8" />
      <polyline points="11,5 14,8 11,11" strokeWidth="1.8" />
    </>
  ))
}

function IconWindsurf(p: IconProps) {
  return wrap(p, (
    <>
      <path d="M3 13 Q6 4 9 6 Q12 8 14 3" strokeWidth="1.6" fill="none" />
      <path d="M3 13 L14 13" strokeWidth="1.2" />
    </>
  ))
}

function IconCline(p: IconProps) {
  return wrap(p, (
    <>
      <polyline points="3,5 8,8 3,11" strokeWidth="1.6" />
      <line x1="10" y1="11" x2="14" y2="11" strokeWidth="1.6" />
    </>
  ))
}

function IconClaude(p: IconProps) {
  return wrap(p, (
    <>
      <path d="M12 5.5 A5.5 5.5 0 1 0 12 10.5" strokeWidth="1.6" fill="none" />
      <polyline points="10,3 12,5.5 9.5,7" strokeWidth="1.4" />
    </>
  ))
}

function IconZed(p: IconProps) {
  return wrap(p, (
    <polyline points="4,4 12,4 4,12 12,12" strokeWidth="1.8" />
  ))
}

function IconAnyClient(p: IconProps) {
  return wrap(p, (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5 Q10.5 5.5 10.5 8 Q10.5 10.5 8 13.5" fill="none" />
      <path d="M8 2.5 Q5.5 5.5 5.5 8 Q5.5 10.5 8 13.5" fill="none" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
    </>
  ))
}

const ICONS: Record<McpClientId, (p: IconProps) => ReactNode> = {
  cursor: IconCursor,
  vscode: IconVSCode,
  'vscode-insiders': IconVSCode,
  windsurf: IconWindsurf,
  cline: IconCline,
  'claude-code': IconClaude,
  'claude-desktop': IconClaude,
  zed: IconZed,
  any: IconAnyClient,
}

export interface ConnectClientIconProps extends IconProps {
  id: McpClientId
}

export function ConnectClientIcon({ id, size, className }: ConnectClientIconProps) {
  const Icon = ICONS[id] ?? IconAnyClient
  return <>{Icon({ size, className })}</>
}

export function renderConnectClientIcon(id: McpClientId, size = 16): ReactNode {
  return <ConnectClientIcon id={id} size={size} />
}
