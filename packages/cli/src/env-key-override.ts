/**
 * FILE: packages/cli/src/env-key-override.ts
 * PURPOSE: Say so when MUSHI_API_KEY in the environment overrides the key the
 *          CLI saved. On 2026-11-11 `mushi login --upgrade-scope` reported a
 *          full-scope key saved, but a Windows user-level MUSHI_API_KEY (an
 *          older ingest-only key) kept winning, so `mushi whoami` still showed
 *          the old key and admin commands failed with no hint why.
 */

/** Lines to print when an environment key differs from the key just saved or in use. Empty when there is nothing to say. */
export function envKeyOverrideLines(env: NodeJS.ProcessEnv, savedKey: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  const envKey = env.MUSHI_API_KEY?.trim()
  if (!envKey || (savedKey && envKey === savedKey)) return []
  const where =
    platform === 'win32'
      ? 'Remove it under Windows Settings → System → About → Advanced system settings → Environment Variables, or open a new terminal after `[Environment]::SetEnvironmentVariable("MUSHI_API_KEY", $null, "User")` in PowerShell.'
      : 'Remove the `export MUSHI_API_KEY=…` line from your shell profile, or run `unset MUSHI_API_KEY` in this terminal.'
  return [
    `⚠ MUSHI_API_KEY is set in your environment (${envKey.slice(0, 12)}…), and it overrides ${savedKey ? `the saved key (${savedKey.slice(0, 12)}…)` : 'the saved key'}.`,
    `  Commands in this terminal use the environment key. ${where}`,
  ]
}
