/**
 * FILE: apps/admin/src/components/design/useFontStylesheets.ts
 * PURPOSE: Load the Google Fonts stylesheets a Directions board needs, only
 *          while the board is on screen. One <link rel="stylesheet"> per URL
 *          for the whole document: mounts are reference-counted, and a link
 *          is removed when the last board using it unmounts. Only
 *          https://fonts.googleapis.com/ URLs are ever injected.
 */

import { useEffect } from 'react'

const ALLOWED_PREFIX = 'https://fonts.googleapis.com/'
const DATA_ATTR = 'data-mushi-font-sheet'

const refs = new Map<string, { el: HTMLLinkElement | null; count: number }>()

function acquire(url: string): void {
  const entry = refs.get(url)
  if (entry) {
    entry.count += 1
    return
  }
  // A page that already loads this stylesheet keeps its own link.
  const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
    (l) => l.href === url,
  )
  if (existing) {
    refs.set(url, { el: null, count: 1 })
    return
  }
  const el = document.createElement('link')
  el.rel = 'stylesheet'
  el.href = url
  el.setAttribute(DATA_ATTR, '')
  document.head.appendChild(el)
  refs.set(url, { el, count: 1 })
}

function release(url: string): void {
  const entry = refs.get(url)
  if (!entry) return
  entry.count -= 1
  if (entry.count > 0) return
  entry.el?.remove()
  refs.delete(url)
}

export function useFontStylesheets(urls: readonly string[]): void {
  const key = urls.filter((u) => u.startsWith(ALLOWED_PREFIX)).join('\n')
  useEffect(() => {
    if (typeof document === 'undefined' || key === '') return
    const list = [...new Set(key.split('\n'))]
    list.forEach(acquire)
    return () => list.forEach(release)
  }, [key])
}
