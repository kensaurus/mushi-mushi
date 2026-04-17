import { MushiProvider, useMushi } from '@mushi-mushi/react'

const ReportButton = () => {
  const { open } = useMushi()
  return (
    <button
      type="button"
      onClick={() => open()}
      style={{
        padding: '0.6rem 1.1rem',
        marginTop: '1.25rem',
        border: 0,
        borderRadius: 8,
        background: '#6366f1',
        color: 'white',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      Report a bug
    </button>
  )
}

export const App = () => (
  <MushiProvider
    config={{
      reporterToken: 'demo_pub_playground',
      endpoint: 'https://demo.api.mushimushi.dev',
      shortcut: 'mod+shift+b',
    }}
  >
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '32rem', padding: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>
          Mushi Mushi 🪲 — React
        </h1>
        <p style={{ color: '#a1a1aa', lineHeight: 1.6 }}>
          The widget is mounted by <code>MushiProvider</code>. Press{' '}
          <kbd>Ctrl+Shift+B</kbd> or click below.
        </p>
        <ReportButton />
      </div>
    </main>
  </MushiProvider>
)
