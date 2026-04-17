import { MushiProvider, MushiErrorBoundary } from '@mushi-mushi/react'

const MUSHI_CONFIG = {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID ?? 'demo_project',
  apiKey: import.meta.env.VITE_MUSHI_API_KEY ?? 'mushi_demo_key',
  apiEndpoint: import.meta.env.VITE_MUSHI_API_ENDPOINT ?? 'http://localhost:54321/functions/v1/api',
}

export function App() {
  return (
    <MushiProvider config={MUSHI_CONFIG}>
      <MushiErrorBoundary>
        <DemoPage />
      </MushiErrorBoundary>
    </MushiProvider>
  )
}

function DemoPage() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Mushi Mushi Demo</h1>
      <p>
        This is a minimal React app with the Mushi Mushi SDK integrated.
        Look for the bug widget in the bottom-right corner.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2>Test Scenarios</h2>

        <button
          style={buttonStyle}
          onClick={() => { /* intentionally does nothing */ }}
        >
          Dead Button (does nothing)
        </button>

        <button
          style={buttonStyle}
          onClick={() => {
            throw new Error('Intentional test error from demo app')
          }}
        >
          Throw Error (tests ErrorBoundary)
        </button>

        <button
          style={buttonStyle}
          onClick={() => {
            fetch('/api/nonexistent-endpoint').catch(() => {})
          }}
        >
          Failed API Call (tests network capture)
        </button>

        <button
          style={buttonStyle}
          onClick={() => {
            console.error('Test console error from demo app')
          }}
        >
          Console Error (tests console capture)
        </button>
      </section>

      <section style={{ marginTop: '2rem', color: '#666' }}>
        <h3>Setup</h3>
        <ol>
          <li>Deploy the Mushi Mushi backend (see <code>SELF_HOSTED.md</code>)</li>
          <li>Copy <code>.env.example</code> to <code>.env</code> and fill in your credentials</li>
          <li>Run <code>pnpm dev</code></li>
          <li>Click the bug widget, submit a report, and check your admin console</li>
        </ol>
      </section>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.75rem 1rem',
  marginBottom: '0.5rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#f9f9f9',
  cursor: 'pointer',
  fontSize: '0.875rem',
  textAlign: 'left',
}
