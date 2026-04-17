import { registerPlugin } from '@capacitor/core';

import type { MushiCapacitorPlugin } from './definitions';
import { WebMushi } from './web';

const MushiNative = registerPlugin<MushiCapacitorPlugin>('MushiMushi', {
  web: () => new WebMushi(),
});

export { MushiNative as Mushi };
export * from './definitions';
