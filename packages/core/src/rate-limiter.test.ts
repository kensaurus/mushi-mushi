import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from './rate-limiter';

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to maxBurst', () => {
    const limiter = createRateLimiter({ maxBurst: 3 });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('refills tokens after refillIntervalMs', () => {
    const limiter = createRateLimiter({
      maxBurst: 2,
      refillRate: 1,
      refillIntervalMs: 1000,
    });

    limiter.tryConsume();
    limiter.tryConsume();
    expect(limiter.tryConsume()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('does not exceed maxBurst on refill', () => {
    const limiter = createRateLimiter({
      maxBurst: 3,
      refillRate: 2,
      refillIntervalMs: 1000,
    });

    limiter.tryConsume();
    vi.advanceTimersByTime(5000);
    expect(limiter.availableTokens()).toBe(3);
  });

  it('reset restores full tokens', () => {
    const limiter = createRateLimiter({ maxBurst: 5 });
    for (let i = 0; i < 5; i++) limiter.tryConsume();
    expect(limiter.availableTokens()).toBe(0);

    limiter.reset();
    expect(limiter.availableTokens()).toBe(5);
  });

  it('uses default config when none provided', () => {
    const limiter = createRateLimiter();
    expect(limiter.availableTokens()).toBe(10);
  });
});
