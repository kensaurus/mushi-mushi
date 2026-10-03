/**
 * Docs 404. The S3 bucket serves this page (status 404) for every missing
 * object, including /mushi-mushi/r/<owner>/<repo> when no static diagram page
 * exists there: the page store is not configured yet, or its write failed.
 * For those paths the live diagram renders client-side; the 404 status keeps
 * it out of search indexes. Everything else gets Nextra's normal 404.
 */

import { NotFoundPage } from 'nextra-theme-docs'
import { DiagramPathFallback } from './r/DiagramPathFallback'

export default function NotFound() {
  return (
    <DiagramPathFallback>
      <NotFoundPage />
    </DiagramPathFallback>
  )
}
