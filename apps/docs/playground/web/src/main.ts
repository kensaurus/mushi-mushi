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

const DEMO_ENDPOINT = 'https://demo.api.mushimushi.dev'

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

// ─── Callbacks (with simulated submit) ───────────────────────────────────────
let submitCount = 0
const callbacks: WidgetCallbacks = {
  onSubmit: async (data) => {
    submitCount++
    log(`onSubmit: category=${data.category} desc="${data.description?.slice(0, 30)}…"`)
    // Simulate network delay
    await new Promise(r => setTimeout(r, 800))
    const mockId = `QA-TEST-${Date.now()}`
    log(`Submit complete: reportId=${mockId}`)
    return { reportId: mockId }
  },
  onOpen: () => log('Widget opened'),
  onClose: () => log('Widget closed'),
  onScreenshotRequest: () => undefined,
  onMushiSignIn: async (email: string) => {
    log(`Magic link requested for: ${email}`)
    await new Promise(r => setTimeout(r, 500))
    return { ok: true }
  },
  onFetchMyReports: async () => {
    log('Fetching my reports…')
    await new Promise(r => setTimeout(r, 600))
    return {
      reports: [
        { id: 'r1', category: 'bug' as const, description: 'Test cross-app report from app A', status: 'fixing', createdAt: new Date().toISOString(), projectName: 'App Alpha' },
        { id: 'r2', category: 'visual' as const, description: 'Visual glitch on nav bar in app B', status: 'fixed', createdAt: new Date(Date.now() - 86400000).toISOString(), projectName: 'App Beta' },
      ]
    }
  },
  onFetchLeaderboard: async () => {
    log('Fetching leaderboard…')
    await new Promise(r => setTimeout(r, 400))
    return {
      entries: [
        { tester_id: 'u1', rank: 1, display_name: 'Alice T.', public_handle: '@alice', points_30d: 450, total_points: 1200, tier_slug: 'gold' },
        { tester_id: 'u2', rank: 2, display_name: 'Bob K.', public_handle: '@bobk', points_30d: 320, total_points: 980, tier_slug: 'silver' },
        { tester_id: 'u3', rank: 3, display_name: 'Chen L.', public_handle: '@chenl', points_30d: 210, total_points: 730, tier_slug: 'silver' },
      ]
    }
  },
}

// ─── Create and mount widget ──────────────────────────────────────────────────
const widget = new MushiWidget(cfg, callbacks)
widget.mount()

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
