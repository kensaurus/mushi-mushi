/**
 * FILE: apps/admin/src/lib/mobileWordmarkHeading.ts
 * PURPOSE: The phone header's visually hidden "mushi mushi" heading. The
 *          desktop sidebar's h1 is display:none below md, and the drawer
 *          only mounts its copy while open, so pages whose title is an h2
 *          (/fixes, /credits, and the rest of the shell) would otherwise
 *          have no level-one heading. Pages that already render an h1 must
 *          not receive a second one.
 */

import { useLayoutEffect, useState } from 'react'

/** True when the phone header should expose the wordmark as the page h1. */
export function showMobileWordmarkH1(drawerOpen: boolean, pageHasH1: boolean): boolean {
  return !drawerOpen && !pageHasH1
}

/**
 * Whether `<main id="main-content">` already contains an h1. The wordmark
 * itself sits in the phone header, outside main, so it is not counted.
 * A mutation observer covers lazy pages that mount their heading after
 * the first paint.
 */
export function useMainHasH1(pathname: string): boolean {
  const [has, setHas] = useState(false)
  useLayoutEffect(() => {
    const main = document.getElementById('main-content')
    if (!main) {
      setHas(false)
      return
    }
    const sync = () => setHas(main.querySelector('h1') != null)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(main, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname])
  return has
}
