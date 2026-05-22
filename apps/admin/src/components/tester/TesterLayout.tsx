/**
 * TesterLayout — slim app shell for Mushi Bounties testers.
 * Replaces the full developer-console Layout with a tester-focused navigation.
 * Used by all /tester/* routes. Each tester page wraps its content with this component.
 */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

const NAV = [
  { label: '🏠 Home',        path: '/tester' },
  { label: '📱 Apps',        path: '/tester/apps' },
  { label: '🐛 Submissions', path: '/tester/submissions' },
  { label: '💰 Wallet',      path: '/tester/wallet' },
  { label: '⚙️ Settings',   path: '/tester/settings' },
]

export function TesterLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen flex flex-col bg-surface-root text-fg">
      {/* Top nav bar */}
      <header className="sticky top-0 z-40 border-b border-edge bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-4 px-4">
          <a href="/tester" className="text-base font-bold">
            <span className="text-brand">mushi</span>mushi
            <span className="ml-2 rounded-sm bg-brand/10 px-1.5 py-0.5 text-2xs font-medium text-brand">
              🪲 Bounties
            </span>
          </a>

          <nav className="hidden sm:flex items-center gap-1">
            {NAV.map(({ label, path }) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/tester'}
                className={({ isActive }) =>
                  `px-2.5 py-1.5 rounded-md text-2xs font-medium motion-safe:transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand'
                      : 'text-fg-muted hover:text-fg hover:bg-surface-raised'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block truncate max-w-[160px] text-2xs text-fg-secondary">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="text-2xs text-fg-faint hover:text-fg motion-safe:transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Mobile bottom tab bar */}
        <nav className="flex sm:hidden border-t border-edge bg-surface px-2 pb-safe">
          {NAV.map(({ label, path }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/tester'}
              className={({ isActive }) =>
                `flex-1 py-2 text-center text-2xs font-medium motion-safe:transition-colors ${
                  isActive ? 'text-brand' : 'text-fg-faint'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="main-content" className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
