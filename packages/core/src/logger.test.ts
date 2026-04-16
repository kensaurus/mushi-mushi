import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, noopLogger } from './logger';
import type { LogEntry } from './logger';

describe('createLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a logger with scope', () => {
    const log = createLogger({ scope: 'test', format: 'json' });
    log.info('hello');

    expect(logSpy).toHaveBeenCalledOnce();
    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.scope).toBe('test');
    expect(entry.msg).toBe('hello');
    expect(entry.level).toBe('info');
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respects log level filtering', () => {
    const log = createLogger({ scope: 'test', level: 'warn', format: 'json' });

    log.debug('should not appear');
    log.info('should not appear');
    log.warn('should appear');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('routes error and fatal to console.error', () => {
    const log = createLogger({ scope: 'test', format: 'json' });
    log.error('bad thing');
    log.fatal('catastrophe');

    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('routes warn to console.warn', () => {
    const log = createLogger({ scope: 'test', format: 'json' });
    log.warn('heads up');

    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('includes metadata in output', () => {
    const log = createLogger({ scope: 'test', format: 'json' });
    log.info('request', { method: 'POST', path: '/v1/reports' });

    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.method).toBe('POST');
    expect(entry.path).toBe('/v1/reports');
  });

  it('includes base meta on all entries', () => {
    const log = createLogger({ scope: 'test', format: 'json', meta: { service: 'api' } });
    log.info('one');
    log.warn('two');

    const entry1: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    const entry2: LogEntry = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(entry1.service).toBe('api');
    expect(entry2.service).toBe('api');
  });

  it('per-call meta overrides base meta', () => {
    const log = createLogger({ scope: 'test', format: 'json', meta: { env: 'prod' } });
    log.info('override', { env: 'staging' });

    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.env).toBe('staging');
  });
});

describe('child loggers', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends scope with colon separator', () => {
    const parent = createLogger({ scope: 'mushi', format: 'json' });
    const child = parent.child('api');
    child.info('hello');

    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.scope).toBe('mushi:api');
  });

  it('inherits parent metadata', () => {
    const parent = createLogger({ scope: 'mushi', format: 'json', meta: { projectId: 'p-1' } });
    const child = parent.child('ingest', { reportId: 'r-1' });
    child.info('ingested');

    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.projectId).toBe('p-1');
    expect(entry.reportId).toBe('r-1');
  });

  it('inherits parent level', () => {
    const parent = createLogger({ scope: 'mushi', level: 'error', format: 'json' });
    const child = parent.child('api');
    child.info('ignored');
    child.error('shown');

    expect(logSpy).not.toHaveBeenCalled();
    expect(vi.mocked(console.error)).toHaveBeenCalledOnce();
  });

  it('supports deep nesting', () => {
    const root = createLogger({ scope: 'mushi', format: 'json' });
    const a = root.child('web');
    const b = a.child('capture');
    b.info('deep');

    const entry: LogEntry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.scope).toBe('mushi:web:capture');
  });
});

describe('setLevel', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dynamically changes the minimum level', () => {
    const log = createLogger({ scope: 'test', level: 'warn', format: 'json' });
    log.info('hidden');
    expect(logSpy).not.toHaveBeenCalled();

    log.setLevel('debug');
    log.info('visible');
    expect(logSpy).toHaveBeenCalledOnce();
  });
});

describe('pretty format', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces human-readable output with scope and level label', () => {
    const log = createLogger({ scope: 'mushi:api', format: 'pretty' });
    log.info('Server started', { port: 3000 });

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('INF');
    expect(output).toContain('[mushi:api]');
    expect(output).toContain('Server started');
    expect(output).toContain('port=3000');
  });

  it('includes metadata key=value pairs', () => {
    const log = createLogger({ scope: 'test', format: 'pretty' });
    log.info('req', { method: 'GET', path: '/health' });

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('method=GET');
    expect(output).toContain('path=/health');
  });
});

describe('noopLogger', () => {
  it('does not emit anything', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    noopLogger.debug('nope');
    noopLogger.info('nope');
    noopLogger.warn('nope');
    noopLogger.error('nope');
    noopLogger.fatal('nope');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('returns noopLogger from child()', () => {
    const child = noopLogger.child('sub');
    expect(child).toBe(noopLogger);
  });
});
