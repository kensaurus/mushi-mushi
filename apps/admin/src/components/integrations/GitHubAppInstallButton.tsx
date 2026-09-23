/**
 * FILE: apps/admin/src/components/integrations/GitHubAppInstallButton.tsx
 * PURPOSE: OAuth-style GitHub App installation flow. Deep-links the user to
 *          the GitHub App's install page with a `state` parameter encoding
 *          the projectId. The GitHub App sends an installation webhook to
 *          POST /v1/webhooks/github/app-installation which reads the state
 *          param and writes `project_repos.github_app_installation_id`.
 *
 *          This is the industry-standard path (Vercel, Sentry, Linear all use
 *          it). PAT is relegated to an advanced <details> disclosure for
 *          self-hosted environments without a public webhook callback URL.
 */

import { Btn, Badge } from '../ui'

interface Props {
  projectId: string
  /** Already have an installation? Show as "Reconnect" */
  hasInstallation?: boolean
  className?: string
}

/**
 * GitHub App slug — set VITE_GITHUB_APP_SLUG in .env or the deploy workflow.
 *
 * Deliberately NOT defaulted. RepoPage used to hard-code `mushi-mushi` here,
 * but `github.com/apps/mushi-mushi` 404s, so baking that in would replace an
 * honest "not configured" note with a button that lands on a GitHub error
 * page. Both entry points now read this one constant, so when the real slug
 * is set they light up together and cannot drift apart.
 */
const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined

/**
 * The App's install URL for a project, or undefined when the slug is unset or
 * there is no project yet. `state` is how the installation callback binds the
 * install to a project, so an empty one would produce an install nothing can
 * attribute.
 */
export function githubAppInstallUrl(projectId: string): string | undefined {
  if (!GITHUB_APP_SLUG || !projectId) return undefined
  return `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(projectId)}`
}

const APP_SLUG = GITHUB_APP_SLUG

export function GitHubAppInstallButton({ projectId, hasInstallation = false, className = '' }: Props) {
  if (!APP_SLUG) {
    // Hiding the button entirely made a misconfigured deploy look like the
    // feature doesn't exist — surface the missing env var instead.
    return (
      <p className={`text-2xs text-fg-muted ${className}`}>
        GitHub App install unavailable: <code>VITE_GITHUB_APP_SLUG</code> is not set for this console.
        Self-hosted? Use the PAT option below.
      </p>
    )
  }

  const installUrl = githubAppInstallUrl(projectId)
  if (!installUrl) return null

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Btn
        variant={hasInstallation ? 'ghost' : 'primary'}
        size="sm"
        onClick={() => window.open(installUrl, '_blank', 'noreferrer')}
      >
        {hasInstallation ? 'Reconnect GitHub App' : 'Install GitHub App'}
      </Btn>
      {hasInstallation && (
        <Badge tone="okSubtle">App connected</Badge>
      )}
      {!hasInstallation && (
        <p className="text-2xs text-fg-muted">
          Opens GitHub — authorizes Mushi to open PRs on your repo.
        </p>
      )}
    </div>
  )
}

/** PAT fallback for self-hosted or air-gapped environments. */
export function GitHubPatDisclosure({ children }: { children: React.ReactNode }) {
  if (!APP_SLUG) {
    return <>{children}</>
  }
  return (
    <details className="text-2xs text-fg-muted mt-2">
      <summary className="cursor-pointer select-none hover:text-fg-secondary transition-opacity">
        Use a PAT instead (legacy / self-hosted)
      </summary>
      <div className="mt-2 pl-2 border-l border-edge-subtle">
        <p className="mb-1 text-2xs text-warn">
          Personal Access Tokens are less secure than GitHub Apps — they use your personal
          permissions and expire on rotation. Use the GitHub App above unless you can't accept
          a public webhook callback URL.
        </p>
        {children}
      </div>
    </details>
  )
}
