import { MushiWidget, type WidgetCallbacks } from '@mushi-mushi/web'

// ─── Feature test harness ────────────────────────────────────────────────────
// Tests all four uplift areas:
//   1. Draggable FAB (drag, snap, persist)
//   2. Keyboard lift (visualViewport)
//   3. Theme inherit + accent
//   4. Community (leaderboard, cross-app, sign-in)

// ─── Config selector ────────────────────────────────────────────────────────
type TestConfig = 'default' | 'draggable' | 'theme-inherit' | 'theme-accent' | 'all-features'
const urlParams = new URLSearchParams(window.location.search)
const testMode = (urlParams.get('mode') as TestConfig) ?? 'all-features'
const themeParam = urlParams.get('theme') as 'light' | 'dark' | null

// Apply dark mode to host page when requested
if (themeParam === 'dark') {
  document.documentElement.style.background = '#111'
  document.documentElement.style.color = '#f5f5f7'
  document.body.style.background = '#111'
  document.body.style.color = '#f5f5f7'
}

const configs: Record<TestConfig, Parameters<typeof MushiWidget>[0]> = {
  default: {
    trigger: 'auto',
  },
  draggable: {
    trigger: 'auto',
    draggable: { persist: true, snapToEdge: true, axis: 'both' },
  },
  'theme-inherit': {
    trigger: 'auto',
    theme: 'inherit',
  },
  'theme-accent': {
    trigger: 'auto',
    theme: 'inherit',
    accent: '#10b981',
  },
  'all-features': {
    trigger: 'auto',
    draggable: { persist: true, snapToEdge: true, axis: 'both' },
    theme: 'inherit',
    accent: '#6366f1',
  },
}

const cfg = configs[testMode] ?? configs['all-features']

// ─── Mock community data ─────────────────────────────────────────────────────
const MOCK_LEADERBOARD = [
  { tester_id: 'u1', rank: 1, display_name: 'Alice T.', public_handle: '@alice', points_30d: 450, total_points: 1200, badge_slug: 'gold' },
  { tester_id: 'u2', rank: 2, display_name: 'Bob K.', public_handle: '@bobk', points_30d: 320, total_points: 980, badge_slug: 'silver' },
  { tester_id: 'u3', rank: 3, display_name: 'Chen L.', public_handle: '@chenl', points_30d: 210, total_points: 730, badge_slug: 'silver' },
  { tester_id: 'u4', rank: 4, display_name: 'Dana M.', public_handle: '@danam', points_30d: 180, total_points: 610, badge_slug: 'bronze' },
  { tester_id: 'u5', rank: 5, display_name: 'Evan R.', public_handle: '@evanr', points_30d: 95, total_points: 430, badge_slug: 'bronze' },
]

const MOCK_CROSS_APP_REPORTS = [
  {
    id: 'r1', short_id: 'R001', title: 'Button not responding on mobile',
    category: 'bug', status: 'fixing',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    project_id: 'p-alpha', app_name: 'App Alpha', app_slug: 'app-alpha',
  },
  {
    id: 'r2', short_id: 'R002', title: 'Visual glitch on nav bar at 375px',
    category: 'visual', status: 'fixed',
    created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString(),
    project_id: 'p-beta', app_name: 'App Beta', app_slug: 'app-beta',
  },
  {
    id: 'r3', short_id: 'R003', title: 'Profile page slow on 4G',
    category: 'slow', status: 'open',
    created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 172800000).toISOString(),
    project_id: 'p-alpha', app_name: 'App Alpha', app_slug: 'app-alpha',
  },
]

const MOCK_REPUTATION = {
  tester_id: 'u1',
  public_handle: '@alice',
  display_name: 'Alice T.',
  total_points: 1200,
  points_30d: 450,
  rank: 1,
}

// ─── Widget instance (declared early so callbacks can reference it) ───────────
let widget: MushiWidget

// ─── Callbacks ───────────────────────────────────────────────────────────────
let submitCount = 0
const callbacks: WidgetCallbacks = {
  onSubmit: async (data) => {
    submitCount++
    log(`onSubmit #${submitCount}: category=${data.category} desc="${data.description?.slice(0, 30)}…"`)
    await new Promise(r => setTimeout(r, 800))
    const mockId = `QA-TEST-${Date.now()}`
    log(`Submit complete: reportId=${mockId}`)
    return { reportId: mockId }
  },
  onOpen: () => log('Widget opened'),
  onClose: () => log('Widget closed'),
  onScreenshotRequest: () => undefined,

  // ── Community: magic-link sign-in ─────────────────────────────────────────
  onMushiSignIn: async (email: string) => {
    log(`Magic link requested for: ${email}`)
    await new Promise(r => setTimeout(r, 500))
    // After "sign in", push session + reputation + leaderboard (simulated)
    setTimeout(() => {
      widget?.setTesterSession('mock-jwt-token', {
        id: 'u1',
        public_handle: '@alice',
        display_name: 'Alice T.',
      })
      widget?.setTesterReputation(MOCK_REPUTATION)
      log('Tester session pushed to widget')
    }, 300)
    return { ok: true }
  },

  // ── Community: opened global leaderboard → fetch + push data ─────────────
  onGlobalLeaderboardOpen: () => {
    log('Fetching leaderboard…')
    widget?.setGlobalLeaderboard(null, true) // show loading state
    setTimeout(() => {
      widget?.setGlobalLeaderboard(MOCK_LEADERBOARD, false)
      log(`Leaderboard pushed: ${MOCK_LEADERBOARD.length} entries`)
    }, 600)
  },

  // ── Community: opened cross-app reports → fetch + push data ──────────────
  onCrossAppReportsOpen: () => {
    log('Fetching cross-app reports…')
    widget?.setCrossAppReports(null, true) // show loading state
    setTimeout(() => {
      widget?.setCrossAppReports(MOCK_CROSS_APP_REPORTS, false)
      log(`Cross-app reports pushed: ${MOCK_CROSS_APP_REPORTS.length} reports`)
    }, 800)
  },
}

// ─── Create and mount widget ──────────────────────────────────────────────────
widget = new MushiWidget(cfg, callbacks)
widget.mount()

// Pre-load reputation for signed-in state (simulate already logged in)
// Comment this out to test the sign-in flow instead
// widget.setTesterSession('mock-jwt', { id: 'u1', public_handle: '@alice', display_name: 'Alice T.' })
// widget.setTesterReputation(MOCK_REPUTATION)

// ─── UI controls ─────────────────────────────────────────────────────────────
document.getElementById('open')?.addEventListener('click', () => widget.open())

// Mode selector buttons
document.querySelectorAll('[data-mode]').forEach(btn => {
  const mode = (btn as HTMLElement).dataset.mode!
  if (mode === testMode) btn.classList.add('active')
  btn.addEventListener('click', () => {
    const u = new URL(window.location.href)
    u.searchParams.set('mode', mode)
    widget.destroy()
    window.location.href = u.toString()
  })
})

// Theme toggle
document.getElementById('toggle-dark')?.addEventListener('click', () => {
  const u = new URL(window.location.href)
  u.searchParams.set('theme', themeParam === 'dark' ? 'light' : 'dark')
  widget.destroy()
  window.location.href = u.toString()
})

// Simulate pre-logged-in community user button
document.getElementById('sim-login')?.addEventListener('click', () => {
  widget.setTesterSession('mock-jwt-token', { id: 'u1', public_handle: '@alice', display_name: 'Alice T.' })
  widget.setTesterReputation(MOCK_REPUTATION)
  log('Simulated sign-in: Alice T. (@alice) — Gold tier')
})

// Simulate sign-out
document.getElementById('sim-logout')?.addEventListener('click', () => {
  widget.setTesterSession(null, null)
  widget.setTesterReputation(null)
  log('Simulated sign-out')
})

// ─── Status output ────────────────────────────────────────────────────────────
const statusEl = document.getElementById('status')
const log = (msg: string) => {
  if (statusEl) {
    const p = document.createElement('p')
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    statusEl.prepend(p)
  }
  console.log('[mushi-test]', msg)
}

log(`Widget created: mode=${testMode} theme=${themeParam ?? 'auto'}`)
log(`Draggable: ${JSON.stringify((cfg as any).draggable ?? false)}`)
log(`Theme: ${(cfg as any).theme ?? 'auto'} | Accent: ${(cfg as any).accent ?? 'default'}`)
log('Widget mounted. Click 🐛 FAB or press Ctrl+Shift+B to open')
