import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Connect your AI client',
  description:
    'Pick your AI coding client and connect Mushi MCP in one click — Cursor, VS Code, Windsurf, Cline, Claude, Zed, and more.',
  openGraph: {
    title: 'Connect your AI client — Mushi Mushi',
    description:
      'Pick your AI coding client and connect Mushi MCP in one click — Cursor, VS Code, Windsurf, Cline, Claude, Zed, and more.',
  },
}

export default function ConnectLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
