/**
 * FILE: packages/node/src/version.ts
 * PURPOSE: Build-time SDK identity stamped on every Node ingest request.
 *
 * OVERVIEW:
 * - `tsup` replaces `__MUSHI_SDK_VERSION__` from package.json at build time
 * - Source/tests fall back to the last published package version
 * - Mirrors packages/web/src/version.ts so catalog + admin can compare
 *
 * USAGE:
 * - MushiNodeClient reads these constants (never a runtime package.json read)
 */

declare const __MUSHI_SDK_VERSION__: string | undefined

export const MUSHI_SDK_PACKAGE = '@mushi-mushi/node'

export const MUSHI_SDK_VERSION =
  typeof __MUSHI_SDK_VERSION__ === 'string' && __MUSHI_SDK_VERSION__
    ? __MUSHI_SDK_VERSION__
    : '1.2.0'
