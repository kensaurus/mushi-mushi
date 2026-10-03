/**
 * FILE: apps/admin/src/components/design/CssScopeColumns.tsx
 * PURPOSE: The app's CSS custom properties, one column per scope (`:root`,
 *          a theme block, or a declared selector such as the light/dark
 *          modes). Each row is the variable, its value, and a swatch from the
 *          server-computed `hex` (data only). Columns stack under 768 px; long
 *          selectors and values wrap instead of widening the page.
 */

import { Badge, Section } from '../ui'
import type { DesignPlaneResponse } from '../../lib/recipeTypes'

type CssScope = DesignPlaneResponse['cssScopes'][number]

const KIND_LABEL: Record<CssScope['kind'], string> = {
  root: ':root',
  theme: '@theme',
  declared: 'Declared scope',
}

export function CssScopeColumns({ scopes }: { scopes: CssScope[] }) {
  if (scopes.length === 0) return null
  const cols = Math.min(scopes.length, 3)
  return (
    <Section
      title="CSS variables by scope"
      action={<span className="text-2xs text-fg-faint">{scopes.length} scopes</span>}
    >
      <div
        className={`grid grid-cols-1 gap-3 ${cols === 2 ? 'md:grid-cols-2' : cols === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`}
        data-testid="css-scopes"
      >
        {scopes.map((scope, i) => (
          <div
            key={`${scope.path}|${scope.selector}|${i}`}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-edge-subtle p-2"
            data-testid="css-scope"
          >
            <header className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 break-all font-mono text-xs font-semibold text-fg">{scope.selector}</code>
                <Badge tone={scope.kind === 'declared' ? 'info' : 'neutral'}>{KIND_LABEL[scope.kind] ?? scope.kind}</Badge>
              </span>
              <span className="break-all font-mono text-2xs text-fg-faint">{scope.path}</span>
            </header>
            {scope.vars.length === 0 ? (
              <p className="text-xs text-fg-muted">No variables in this scope.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {scope.vars.map((v) => (
                  <li key={v.name} className="flex min-w-0 items-start gap-2 text-2xs">
                    {v.hex ? (
                      <span
                        className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-edge"
                        style={{ background: v.hex }}
                        role="img"
                        aria-label={`Swatch ${v.hex}`}
                      />
                    ) : (
                      <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="break-all font-mono text-fg">{v.name}</span>
                      <span className="break-all font-mono text-fg-muted">{v.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}
