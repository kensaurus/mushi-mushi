/**
 * AGENTS.md's "**Introduced in** … **x.y.z** (current: **x.y.z**)" SDK claims,
 * checked (and with `write`, repaired) against the workspace package versions.
 * Used by scripts/check-docs-versions.mjs; tested in
 * scripts/check-docs-versions.test.mjs.
 *
 * Each pattern captures the text before the current version, the version, and
 * the closing `**`, so a rewrite replaces exactly the `(current: **…**)` value.
 * Rewriting by the first occurrence of the version string instead would hit
 * the "Introduced in" version whenever the two are equal.
 */

function majorMinor(version) {
  const parts = String(version).trim().split(".")
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
}

const AGENTS_CLAIMS = [
  {
    label: "core/web SDK",
    // Either version is accepted while core and web diverge mid-release; a
    // rewrite uses core.
    pkgs: ["@mushi-mushi/core", "@mushi-mushi/web"],
    re: /(@mushi-mushi\/core`\s*\/\s*`@mushi-mushi\/web`\s*\*\*[0-9.]+\*\*\s*\(current:\s*\*\*)([0-9]+\.[0-9]+\.[0-9]+)(\*\*)/,
  },
  {
    label: "react-native SDK",
    pkgs: ["@mushi-mushi/react-native"],
    re: /(`@mushi-mushi\/react-native`\s*\*\*[0-9.]+\*\*\s*\(current:\s*\*\*)([0-9]+\.[0-9]+\.[0-9]+)(\*\*)/,
  },
]

/**
 * @param {string} text AGENTS.md contents
 * @param {Record<string, string>} versions package name → workspace version
 * @param {boolean} write rewrite drifted claims instead of reporting them
 * @returns {{ text: string, findings: string[], rewrites: string[] }}
 */
export function checkAgentsClaims(text, versions, write) {
  const findings = []
  const rewrites = []
  let out = text
  for (const claim of AGENTS_CLAIMS) {
    const actual = claim.pkgs.map((p) => versions[p])
    if (actual.some((v) => !v)) continue
    const m = out.match(claim.re)
    if (!m) continue
    const claimed = m[2]
    if (actual.some((v) => majorMinor(v) === majorMinor(claimed))) continue
    const next = actual[0]
    if (write) {
      out = out.replace(claim.re, (_all, before, _old, after) => `${before}${next}${after}`)
      rewrites.push(`current ${claim.label} claim ${claimed} → ${next}`)
    } else {
      findings.push(
        `AGENTS.md: current ${claim.label} claim ${claimed} matches none of ` +
          claim.pkgs.map((p, i) => `${p}@${actual[i]}`).join(", ") +
          " — run `pnpm sync:docs-versions`"
      )
    }
  }
  return { text: out, findings, rewrites }
}
