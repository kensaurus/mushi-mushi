/**
 * GitHub URL predicates.
 *
 * Plain `url.includes('github.com')` / `hostname.endsWith('github.com')` checks
 * are incomplete (CodeQL js/incomplete-url-substring-sanitization): they also
 * match `evil-github.com` or `github.com.attacker.test`. Parse the URL and
 * compare the hostname against the real GitHub hosts instead.
 */

/** `github.com`, `www.github.com`, or any `*.github.com` subdomain. */
export function isGithubHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'github.com' || h === 'www.github.com' || h.endsWith('.github.com')
}

/** True when `url` is a well-formed URL whose host is GitHub. */
export function isGithubUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return isGithubHostname(new URL(url).hostname)
  } catch {
    return false
  }
}
