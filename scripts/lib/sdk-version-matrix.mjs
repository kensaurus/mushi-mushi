/**
 * scripts/lib/sdk-version-matrix.mjs — semver snapshots for published SDK packages.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

/** Packages grouped for the docs hub version table (display order). */
export const VERSION_MATRIX_GROUPS = [
  {
    label: "@mushi-mushi/core, @mushi-mushi/web",
    packages: ["core", "web"],
    display: (versions) => {
      const v = versions.core ?? versions.web
      return v ? `${majorMinor(v)}.x` : null
    },
  },
  { label: "@mushi-mushi/react", packages: ["react"] },
  { label: "@mushi-mushi/react-native", packages: ["react-native"] },
  { label: "@mushi-mushi/cli", packages: ["cli"] },
  { label: "@mushi-mushi/mcp", packages: ["mcp"] },
  { label: "@mushi-mushi/capacitor", packages: ["capacitor"] },
  { label: "@mushi-mushi/node", packages: ["node"] },
  {
    label: "@mushi-mushi/angular, @mushi-mushi/vue, @mushi-mushi/svelte",
    packages: ["angular", "vue", "svelte"],
    display: (versions) => {
      const v = versions.angular ?? versions.vue ?? versions.svelte
      return v ? `${majorMinor(v)}.x` : null
    },
  },
  { label: "mushi-mushi (launcher)", dir: "launcher", name: "mushi-mushi" },
]

function majorMinor(version) {
  const parts = String(version).split(".")
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
}

function readPackageVersion(packagesDir, dir) {
  const pkgPath = path.join(packagesDir, dir, "package.json")
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  if (pkg.private) return null
  return pkg.version ?? null
}

export function collectPackageVersions(root = process.cwd()) {
  const packagesDir = path.join(root, "packages")
  const byDir = {}
  if (!existsSync(packagesDir)) return byDir
  for (const dir of readdirSync(packagesDir)) {
    const v = readPackageVersion(packagesDir, dir)
    if (v) byDir[dir] = v
  }
  return byDir
}

export function renderVersionMatrixMarkdown(root = process.cwd()) {
  const packagesDir = path.join(root, "packages")
  const versions = collectPackageVersions(root)
  const lines = ["| Package | Version |", "| --- | --- |"]

  for (const group of VERSION_MATRIX_GROUPS) {
    let display
    if (group.display) {
      const lookup = Object.fromEntries(
        group.packages.map((p) => [p, versions[p]])
      )
      display = group.display(lookup)
    } else if (group.dir) {
      const v = readPackageVersion(packagesDir, group.dir)
      display = v ? `${majorMinor(v)}.x` : null
    } else {
      const v = versions[group.packages[0]]
      display = v ? `${majorMinor(v)}.x` : null
    }
    if (!display) continue
    lines.push(`| ${group.label} | ${display} |`)
  }

  return lines.join("\n")
}

// MDX v3 (nextra 4) rejects HTML comments — `<` starts a JSX tag and `!` is an
// illegal name char. Use MDX expression comments so the markers survive the
// docs build while staying invisible in the rendered page.
export const VERSION_MATRIX_START = "{/* sdk-version-matrix:start */}"
export const VERSION_MATRIX_END = "{/* sdk-version-matrix:end */}"

export function replaceVersionMatrixBlock(source, tableMarkdown) {
  const start = source.indexOf(VERSION_MATRIX_START)
  const end = source.indexOf(VERSION_MATRIX_END)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "Missing sdk-version-matrix markers in apps/docs/content/sdks/index.mdx"
    )
  }
  const before = source.slice(0, start + VERSION_MATRIX_START.length)
  const after = source.slice(end)
  return `${before}\n${tableMarkdown}\n${after}`
}
