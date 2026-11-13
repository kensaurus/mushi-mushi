/**
 * Docs 404. The S3 bucket serves this page (status 404) for every missing
 * object, including /mushi-mushi/r/<owner>/<repo> when no static diagram page
 * exists there: the page store is not configured yet, or its write failed.
 * For those paths the live diagram renders client-side; the 404 status keeps
 * it out of search indexes. /…/check/<uuid> renders that Production Check
 * report the same way. Everything else gets Nextra's normal 404, with the
 * field guide above the heading (components/Mascot.tsx).
 */

import { NotFoundPage, useMDXComponents } from 'nextra-theme-docs'
import { DiagramPathFallback } from './r/DiagramPathFallback'
import { CheckPathFallback } from './check/CheckPathFallback'
import { Mascot } from '../components/Mascot'

export default function NotFound() {
  const { h1: H1 } = useMDXComponents()
  return (
    <DiagramPathFallback>
      <CheckPathFallback>
        <NotFoundPage>
          <Mascot pose="think" line="This page isn't in my field notes. It may have moved; the search can find it." />
          <H1>404: Page Not Found</H1>
        </NotFoundPage>
      </CheckPathFallback>
    </DiagramPathFallback>
  )
}
