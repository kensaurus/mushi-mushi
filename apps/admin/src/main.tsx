import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { initSentry } from './lib/sentry'
import { hydrateDensity } from './lib/useDensity'
import { hydrateTheme } from './lib/useTheme'
import { sanitizeTenantUrlParams } from './lib/tenantUrlSanitize'
import { MotionProvider } from './components/providers/MotionProvider'
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
  // PWA service worker (share target, push, app-shell cache). Registered
  // after load so it never competes with first paint; the module is tiny
  // and guards itself when the browser has no SW support.
  import('./lib/pwaRegister')
    .then(({ registerServiceWorker }) => registerServiceWorker())
    .catch(() => {
      /* non-fatal: the console works without a service worker */
    })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </MotionProvider>
  </StrictMode>,
)
