import { describe, it, expect } from 'vitest';
import { captureEnvironment } from './environment';

describe('captureEnvironment', () => {
  it('returns a valid MushiEnvironment object', () => {
    const env = captureEnvironment();

    expect(env).toBeDefined();
    expect(env.userAgent).toBeTypeOf('string');
    expect(env.platform).toBeTypeOf('string');
    expect(env.language).toBeTypeOf('string');
    expect(env.viewport).toBeDefined();
    expect(env.viewport.width).toBeTypeOf('number');
    expect(env.viewport.height).toBeTypeOf('number');
    expect(env.timestamp).toBeTypeOf('string');
    expect(env.timezone).toBeTypeOf('string');
  });

  it('captures a valid ISO timestamp', () => {
    const env = captureEnvironment();
    const parsed = new Date(env.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('captures viewport dimensions', () => {
    const env = captureEnvironment();
    expect(env.viewport.width).toBeGreaterThanOrEqual(0);
    expect(env.viewport.height).toBeGreaterThanOrEqual(0);
  });
});
