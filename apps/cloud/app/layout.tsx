import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Mushi Mushi Cloud — Bug intelligence that fixes itself',
    template: '%s — Mushi Mushi Cloud',
  },
  description:
    'Sign up for Mushi Mushi Cloud. Pay only for the reports you ingest. 1,000 reports/month free.',
  metadataBase: new URL('https://mushimushi.dev'),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>{children}</body>
    </html>
  )
}
