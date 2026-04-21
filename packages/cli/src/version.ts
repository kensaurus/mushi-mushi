/**
 * FILE: packages/cli/src/version.ts
 * PURPOSE: Single source of truth for the CLI version at runtime.
 *
 * The bundler (tsup) replaces `__MUSHI_CLI_VERSION__` with the literal from
 * `package.json` at build time. Falling back to `'0.0.0-dev'` keeps
 * `tsc --noEmit` happy during development.
 */

declare const __MUSHI_CLI_VERSION__: string | undefined

export const MUSHI_CLI_VERSION: string =
  typeof __MUSHI_CLI_VERSION__ === 'string' ? __MUSHI_CLI_VERSION__ : '0.0.0-dev'
