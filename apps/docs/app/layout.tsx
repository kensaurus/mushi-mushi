import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { highlights } from "@/lib/highlights"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Mushi Docs",
  description: "Mushi error monitoring documentation",
}

function latestHeadline(): string {
  if (!highlights || highlights.length === 0) return ""
  return highlights
    .slice(0, 3)
    .map((h) => h.title.replace(/[.:,;!?]+$/, ""))
    .join(" · ")
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headline = latestHeadline()

  return (
    <html lang="en">
      <body className={inter.className}>
        {headline && (
          <div className="announcement-bar">
            {headline}
          </div>
        )}
        {children}
      </body>
    </html>
  )
}
