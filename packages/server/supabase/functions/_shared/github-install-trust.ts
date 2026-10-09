/**
 * GitHub App installation ids reach us unauthenticated: the install
 * callback's `installation_id` and `state` are plain query parameters, and
 * POST /codebase/enable accepts one in its body. Binding an id to a project
 * lets the indexer mint tokens for that installation, so on a multi-tenant
 * deployment an installation someone else made could be bound to another
 * tenant's project and its private repositories indexed there.
 *
 * Until the callback verifies the installer through GitHub's user
 * authorization (the `code` GitHub sends when "Request user authorization
 * during installation" is on), bindings are refused unless a single-tenant
 * self-host opts in with MUSHI_GITHUB_APP_TRUST_UNVERIFIED_INSTALLS=1.
 * Security pass 2026-09-23; hosted production has no App configured.
 */

declare const Deno: { env: { get(name: string): string | undefined } }

export function unverifiedGithubInstallsAllowed(): boolean {
  return Deno.env.get('MUSHI_GITHUB_APP_TRUST_UNVERIFIED_INSTALLS') === '1'
}
