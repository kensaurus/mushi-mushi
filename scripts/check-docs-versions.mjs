#!/usr/bin/env node
/**
 * Fail when docs advertise SDK versions that don't match the workspace.
 *
 *   pnpm check:docs-drift   (runs this + check-docs-links.mjs)
 *   node scripts/check-docs-versions.mjs
 *
 * Guards against the drift class where quickstart/install snippets pin a
 * version that was never published (e.g. docs advertised native SDK `0.8.0`
 * while the real Flutter/Android/iOS packages sat at 0.3.0 / 0.4.0).
 *
 * Scans every install snippet under apps/docs/content for a pinned version and
 * compares its MAJOR.MINOR against the real source-of-truth version:
 *   - npm  `@mushi-mushi/<pkg>@x.y.z`  → packages/<pkg>/package.json
 *   - Flutter `mushi_mushi: ^x.y.z`     → packages/flutter/pubspec.yaml
 *   - Android `dev.mushimushi:sdk:x.y.*`→ packages/android/build.gradle.kts
 *   - iOS  `mushi-mushi-ios ... from:"x.y.z"` → packages/ios/MushiMushi.podspec
 *
 * MAJOR.MINOR (not exact patch) is compared on purpose: the docs use range
 * pins (`^`, `from:`, `.+`), so a patch bump behind the docs still resolves and
 * shouldn't churn the docs — but a minor/major that doesn't exist is a broken
 * install instruction and fails here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "apps/docs/content")

function majorMinor(version) {
  const parts = String(version).trim().split(".")
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
}

/** Read the first `version:` line from a pubspec.yaml. */
function readPubspecVersion(pubspecPath) {
  if (!existsSync(pubspecPath)) return null
  const m = readFileSync(pubspecPath, "utf8").match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)/m)
  return m ? m[1] : null
}

/** Read `version = "x.y.z"` from a Gradle build script. */
function readGradleVersion(gradlePath) {
  if (!existsSync(gradlePath)) return null
  const m = readFileSync(gradlePath, "utf8").match(/^\s*version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)/m)
  return m ? m[1] : null
}

/** Read `s.version = 'x.y.z'` from a CocoaPods podspec. */
function readPodspecVersion(podspecPath) {
  if (!existsSync(podspecPath)) return null
  const m = readFileSync(podspecPath, "utf8").match(/\.version\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)/)
  return m ? m[1] : null
}

/** Map every published @mushi-mushi npm package name → its version. */
function collectNpmVersions() {
  const packagesDir = path.join(ROOT, "packages")
  const byName = {}
  if (!existsSync(packagesDir)) return byName
  for (const dir of readdirSync(packagesDir)) {
    const pkgPath = path.join(packagesDir, dir, "package.json")
    if (!existsSync(pkgPath)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    } catch {
      continue
    }
    if (pkg.private || !pkg.name || !pkg.version) continue
    byName[pkg.name] = pkg.version
  }
  return byName
}

const npmVersions = collectNpmVersions()
const flutterVersion = readPubspecVersion(path.join(ROOT, "packages/flutter/pubspec.yaml"))
const androidVersion = readGradleVersion(path.join(ROOT, "packages/android/build.gradle.kts"))
const iosVersion = readPodspecVersion(path.join(ROOT, "packages/ios/MushiMushi.podspec"))

// Native install-snippet matchers. Each captures the pinned x.y.z (or x.y for
// the Gradle `.+` dynamic form) and compares MAJOR.MINOR to the real version.
const NATIVE_MATCHERS = [
  {
    id: "flutter",
    label: "Flutter (mushi_mushi in pubspec.yaml)",
    actual: flutterVersion,
    re: /mushi_mushi:\s*[\^~]?([0-9]+\.[0-9]+\.[0-9]+)/g,
  },
  {
    id: "android",
    label: "Android (dev.mushimushi:sdk)",
    actual: androidVersion,
    re: /dev\.mushimushi:sdk:([0-9]+\.[0-9]+)(?:\.(?:[0-9]+|\+))?/g,
  },
  {
    id: "ios",
    label: "iOS (mushi-mushi-ios SwiftPM)",
    actual: iosVersion,
    re: /mushi-mushi-ios.*?from:\s*["']([0-9]+\.[0-9]+\.[0-9]+)/g,
  },
]

const npmPinRe = /(@mushi-mushi\/[a-z0-9-]+)@([0-9]+\.[0-9]+\.[0-9]+)/g

function walkDocs(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walkDocs(full, acc)
    else if (name.endsWith(".mdx") || name.endsWith(".md")) acc.push(full)
  }
  return acc
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length
}

const findings = []
const files = walkDocs(CONTENT)

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const source = readFileSync(file, "utf8")

  // npm pins: only flag packages that actually exist in the workspace.
  for (const m of source.matchAll(npmPinRe)) {
    const [, name, pinned] = m
    const actual = npmVersions[name]
    if (!actual) continue
    if (majorMinor(pinned) !== majorMinor(actual)) {
      findings.push(
        `${rel}:${lineOf(source, m.index)} ${name} pinned @${pinned} but workspace is ${actual}`
      )
    }
  }

  // native pins
  for (const matcher of NATIVE_MATCHERS) {
    if (!matcher.actual) continue
    matcher.re.lastIndex = 0
    for (const m of source.matchAll(matcher.re)) {
      const pinned = m[1]
      if (majorMinor(pinned) !== majorMinor(matcher.actual)) {
        findings.push(
          `${rel}:${lineOf(source, m.index)} ${matcher.label} pins ${pinned} but real version is ${matcher.actual}`
        )
      }
    }
  }
}

// Root canon claims that live outside apps/docs/content (allowlist gap).
{
  const agentsPath = path.join(ROOT, "AGENTS.md")
  if (existsSync(agentsPath)) {
    const agents = readFileSync(agentsPath, "utf8")
    const coreVer = npmVersions["@mushi-mushi/core"]
    const webVer = npmVersions["@mushi-mushi/web"]
    const m = agents.match(
      /@mushi-mushi\/core`\s*\/\s*`@mushi-mushi\/web`\s*\*\*[0-9.]+\*\*\s*\(current:\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/
    )
    if (m && coreVer && webVer) {
      const claimed = m[1]
      // Accept either core or web version if they diverge mid-release; both
      // should match claimed when CHANGELOG lists a joint bump.
      if (
        majorMinor(claimed) !== majorMinor(coreVer) &&
        majorMinor(claimed) !== majorMinor(webVer)
      ) {
        findings.push(
          `AGENTS.md: current SDK claim ${claimed} matches neither core@${coreVer} nor web@${webVer}`
        )
      }
    }
  }

  const visionPath = path.join(ROOT, "VISION.md")
  if (existsSync(visionPath)) {
    const vision = readFileSync(visionPath, "utf8")
    const pluginPkgs = Object.keys(npmVersions).filter(
      (n) => n.startsWith("@mushi-mushi/plugin-") && n !== "@mushi-mushi/plugin-sdk"
    )
    const expectedPlugins = pluginPkgs.length
    const vm = vision.match(/(\d+)\s+plugins/)
    if (vm && expectedPlugins > 0 && Number(vm[1]) !== expectedPlugins) {
      findings.push(
        `VISION.md: claims ${vm[1]} plugins but workspace has ${expectedPlugins} outbound plugins`
      )
    }
  }
}

// Surface any source-of-truth we failed to read, so a moved/renamed manifest
// silently disabling a matcher shows up instead of passing green.
const missing = []
if (!flutterVersion) missing.push("packages/flutter/pubspec.yaml")
if (!androidVersion) missing.push("packages/android/build.gradle.kts")
if (!iosVersion) missing.push("packages/ios/MushiMushi.podspec")
if (missing.length > 0) {
  console.error(
    "Docs version check: could not read native SDK version from:\n" +
      missing.map((f) => `- ${f}`).join("\n")
  )
  process.exit(1)
}

if (findings.length > 0) {
  console.error("Docs version drift:\n" + findings.map((f) => `- ${f}`).join("\n"))
  process.exit(1)
}

console.log(
  `Docs version check passed (${files.length} files; Flutter ${flutterVersion}, Android ${androidVersion}, iOS ${iosVersion}).`
)
