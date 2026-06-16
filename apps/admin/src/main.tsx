import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { initSentry } from './lib/sentry'
import { hydrateDensity } from './lib/useDensity'
import { hydrateTheme } from './lib/useTheme'
import { sanitizeTenantUrlParams } from './lib/tenantUrlSanitize'
import './index.css'

initSentry()
hydrateDensity()
hydrateTheme()
sanitizeTenantUrlParams()

// Defer web-vitals observation until after first paint so it has zero cost
// on the critical render path. The dynamic import is intentional — the
// web-vitals library (~8KB) must not block the initial bundle.
// `.catch` is non-optional: a chunk-load failure on a poor network must not
// surface as an Unhandled Promise rejection in Sentry.
window.addEventListener('load', () => {
  import('./lib/web-vitals')
    .then(({ reportWebVitals }) => reportWebVitals())
    .catch(() => {
      /* non-fatal: vitals collection is best-effort */
    })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
