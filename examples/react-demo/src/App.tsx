import { MushiProvider, MushiErrorBoundary } from '@mushi-mushi/react'

const MUSHI_CONFIG = {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID ?? 'demo_project',
  apiKey: import.meta.env.VITE_MUSHI_API_KEY ?? 'mushi_demo_key',
  apiEndpoint: import.meta.env.VITE_MUSHI_API_ENDPOINT ?? 'http://localhost:54321/functions/v1/api',
  runtimeConfig: false,
  widget: {
    trigger: 'edge-tab' as const,
    triggerText: 'Report bug',
    position: 'bottom-right' as const,
    theme: 'light' as const,
  },
}

export function App() {
  return (
    <MushiProvider config={MUSHI_CONFIG}>
      <MushiErrorBoundary>
        <CheckoutDogfoodPage />
      </MushiErrorBoundary>
    </MushiProvider>
  )
}

/** glot.it-style checkout page used for marketing GIFs — mirrors reportSample. */
function CheckoutDogfoodPage() {
  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <span style={logoStyle}>glot.it</span>
        <span style={pathStyle}>/checkout</span>
      </header>

      <main style={mainStyle}>
        <section style={cardStyle}>
          <p style={eyebrowStyle}>Spring sale</p>
          <h1 style={titleStyle}>Spring coupon applied</h1>
          <p style={bodyStyle}>
            Your 20% discount is active. Complete checkout below — if the pay button slips under the
            bottom bar, tap <strong>Report bug</strong> on the right edge.
          </p>

          <div style={summaryStyle}>
            <div style={rowStyle}>
              <span>Thai Basics — annual</span>
              <span>฿1,590</span>
            </div>
            <div style={rowStyle}>
              <span>Spring coupon</span>
              <span style={{ color: '#059669' }}>−฿318</span>
            </div>
            <div style={{ ...rowStyle, fontWeight: 700, borderTop: '1px solid #e7e5e4', paddingTop: '0.75rem' }}>
              <span>Total</span>
              <span>฿1,272</span>
            </div>
          </div>

          <button type="button" style={payButtonStyle}>
            Pay with card
          </button>
          <p style={hintStyle}>Demo page for Mushi SDK capture — edge-tab launcher on the right →</p>
        </section>
      </main>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #fff7ed 0%, #fafaf9 40%)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#1c1917',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  padding: '1.25rem 1.5rem',
  borderBottom: '1px solid #e7e5e4',
  background: 'rgba(255,255,255,0.85)',
}

const logoStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '1.125rem',
  letterSpacing: '-0.02em',
}

const pathStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#78716c',
  fontFamily: 'ui-monospace, monospace',
}

const mainStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: '0 auto',
  padding: '2.5rem 1.5rem 6rem',
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e5e4',
  borderRadius: 16,
  padding: '1.75rem',
  boxShadow: '0 24px 48px -32px rgba(28,25,23,0.25)',
}

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.6875rem',
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: '#d97706',
  fontWeight: 600,
}

const titleStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: '1.75rem',
  letterSpacing: '-0.03em',
  lineHeight: 1.15,
}

const bodyStyle: React.CSSProperties = {
  margin: '1rem 0 0',
  fontSize: '0.9375rem',
  lineHeight: 1.6,
  color: '#57534e',
}

const summaryStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  fontSize: '0.875rem',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
}

const payButtonStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  width: '100%',
  padding: '0.875rem 1rem',
  border: 'none',
  borderRadius: 10,
  background: '#1c1917',
  color: '#fff',
  fontSize: '0.9375rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const hintStyle: React.CSSProperties = {
  margin: '1.25rem 0 0',
  fontSize: '0.75rem',
  color: '#a8a29e',
  lineHeight: 1.5,
}
