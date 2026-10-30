/**
 * FILE: apps/admin/src/components/integrations/GitHubAppInstallButton.tsx
 * PURPOSE: Entry to the GitHub App from cards outside Connect. It opens the
 *          verified "Connect GitHub" card (components/GitHubConnectCard.tsx),
 *          which signs the person in to GitHub before anything is bound. The
 *          old link carried the bare project id as `state`; the setup URL
 *          refuses that on a hosted server (install_unverified), so it was a
 *          dead button. PAT stays in an advanced <details> disclosure for
 *          self-hosted environments without a public callback URL.
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
 * Where to connect the GitHub App for a project (the verified card on
 * Connect), or undefined when the slug is unset or there is no project yet.
 */
export function githubAppConnectPath(projectId: string): string | undefined {
  if (!GITHUB_APP_SLUG || !projectId) return undefined
  return `/connect?project=${encodeURIComponent(projectId)}#connect-github`
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

  const connectPath = githubAppConnectPath(projectId)
  if (!connectPath) return null

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Btn variant={hasInstallation ? 'ghost' : 'primary'} size="sm" to={connectPath}>
        {hasInstallation ? 'Change repository' : 'Connect GitHub'}
      </Btn>
      {hasInstallation && (
        <Badge tone="okSubtle">App connected</Badge>
      )}
      {!hasInstallation && (
        <p className="text-2xs text-fg-muted">
          You sign in to GitHub, then pick the repository Mushi opens PRs on.
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
