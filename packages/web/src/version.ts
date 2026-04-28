declare const __MUSHI_SDK_VERSION__: string | undefined;

export const MUSHI_SDK_PACKAGE = '@mushi-mushi/web';
export const MUSHI_SDK_VERSION =
  typeof __MUSHI_SDK_VERSION__ === 'string' && __MUSHI_SDK_VERSION__
    ? __MUSHI_SDK_VERSION__
    : '0.7.0';
