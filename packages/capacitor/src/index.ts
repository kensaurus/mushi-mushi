import { registerPlugin } from '@capacitor/core';

import type { MushiCapacitorPlugin } from './definitions';
import { WebMushi } from './web';

const MushiNative = registerPlugin<MushiCapacitorPlugin>('MushiMushi', {
  web: () => new WebMushi(),
});

/** `init` is an alias for `configure` — matches the web SDK entry point. */
export const Mushi = Object.assign(MushiNative, {
  init: (options: Parameters<MushiCapacitorPlugin['configure']>[0]) => MushiNative.configure(options),
});
export * from './definitions';
