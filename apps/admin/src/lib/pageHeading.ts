/**
 * Pages whose title is the only h1. The shell wordmark stays a paragraph
 * there so heading order does not skip, including at phone width where the
 * sidebar (and its wordmark heading) is not in the accessibility tree.
 */
const PAGE_SUPPLIES_H1 = new Set(['/fixes'])

export function pageSuppliesH1(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return PAGE_SUPPLIES_H1.has(path)
}
