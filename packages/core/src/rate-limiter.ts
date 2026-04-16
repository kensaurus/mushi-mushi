export interface RateLimiterConfig {
  maxBurst?: number;
  refillRate?: number;
  refillIntervalMs?: number;
}

export interface RateLimiter {
  tryConsume(): boolean;
  reset(): void;
  availableTokens(): number;
}

const DEFAULT_MAX_BURST = 10;
const DEFAULT_REFILL_RATE = 1;
const DEFAULT_REFILL_INTERVAL_MS = 5_000;

export function createRateLimiter(config: RateLimiterConfig = {}): RateLimiter {
  const {
    maxBurst = DEFAULT_MAX_BURST,
    refillRate = DEFAULT_REFILL_RATE,
    refillIntervalMs = DEFAULT_REFILL_INTERVAL_MS,
  } = config;

  let tokens = maxBurst;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;
    const refills = Math.floor(elapsed / refillIntervalMs);
    if (refills > 0) {
      tokens = Math.min(maxBurst, tokens + refills * refillRate);
      lastRefill = now;
    }
  }

  function tryConsume(): boolean {
    refill();
    if (tokens > 0) {
      tokens--;
      return true;
    }
    return false;
  }

  function reset(): void {
    tokens = maxBurst;
    lastRefill = Date.now();
  }

  function availableTokens(): number {
    refill();
    return tokens;
  }

  return { tryConsume, reset, availableTokens };
}
