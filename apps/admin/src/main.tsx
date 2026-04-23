import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { initSentry } from './lib/sentry'
import { hydrateDensity } from './lib/useDensity'
import { hydrateTheme } from './lib/useTheme'
import './index.css'

initSentry()
hydrateDensity()
hydrateTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
