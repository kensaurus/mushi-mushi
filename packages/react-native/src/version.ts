declare const __MUSHI_SDK_VERSION__: string | undefined

/**
 * Package + version stamped onto every report so the admin console can show
 * "SDK @mushi-mushi/react-native 0.x.y" and flag outdated installs. The
 * version string is injected at build time by tsup's `define` (see
 * tsup.config.ts); the literal fallback keeps `vitest`/ts-node happy where the
 * define isn't applied.
 */
export const MUSHI_SDK_PACKAGE = '@mushi-mushi/react-native'
export const MUSHI_SDK_VERSION =
  typeof __MUSHI_SDK_VERSION__ === 'string' && __MUSHI_SDK_VERSION__
    ? __MUSHI_SDK_VERSION__
    : '0.17.0'
