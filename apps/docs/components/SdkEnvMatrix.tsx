/**
 * Framework × env var reference — Supabase-style env block for SDK integrators.
 */

interface EnvRow {
  framework: string
  vars: string
  notes?: string
}

const ROWS: readonly EnvRow[] = [
  {
    framework: 'Vite / Vanilla JS',
    vars: 'VITE_MUSHI_PROJECT_ID, VITE_MUSHI_API_KEY',
    notes: 'Optional: VITE_MUSHI_API_ENDPOINT for self-host',
  },
  {
    framework: 'Next.js',
    vars: 'NEXT_PUBLIC_MUSHI_PROJECT_ID, NEXT_PUBLIC_MUSHI_API_KEY',
    notes: 'Baked at build time for static export / Capacitor',
  },
  {
    framework: 'CLI / Node server',
    vars: 'MUSHI_PROJECT_ID, MUSHI_API_KEY',
    notes: 'MUSHI_API_ENDPOINT for self-host',
  },
  {
    framework: 'MCP (Cursor, VS Code)',
    vars: 'MUSHI_PROJECT_ID, MUSHI_API_KEY, MUSHI_API_ENDPOINT',
    notes: 'MCP read+write key — server-side only',
  },
  {
    framework: 'Reward webhook',
    vars: 'MUSHI_REWARD_WEBHOOK_SECRET',
    notes: 'Minted once in Admin → Rewards → Webhooks',
  },
]

export function SdkEnvMatrix() {
  return (
    <div className="not-prose overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--mushi-rule)]">
            <th scope="col" className="text-left py-2 pr-4 font-semibold">Surface</th>
            <th scope="col" className="text-left py-2 pr-4 font-semibold">Variables</th>
            <th scope="col" className="text-left py-2 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.framework} className="border-b border-[var(--mushi-rule)]/60">
              <td className="py-2 pr-4 align-top whitespace-nowrap">{r.framework}</td>
              <td className="py-2 pr-4 align-top">
                <code className="text-xs">{r.vars}</code>
              </td>
              <td className="py-2 align-top text-[var(--mushi-ink-muted)]">{r.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
