import { describe, it, expect } from 'vitest';
import { normaliseThrown } from './exception-normaliser';

describe('normaliseThrown', () => {
  it('passes Error through with name/message/stack', () => {
    const err = new Error('boom');
    const out = normaliseThrown(err);
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
  });

  it('keeps a custom Error subclass name', () => {
    class TimeoutError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
      }
    }
    const out = normaliseThrown(new TimeoutError('slow'));
    expect(out.name).toBe('TimeoutError');
    expect(out.message).toBe('slow');
  });

  it('captures Error.cause if present', () => {
    const root = new Error('root');
    const wrapper = new Error('wrap', { cause: root });
    const out = normaliseThrown(wrapper);
    expect(out.cause).toBe('root');
  });

  it('passes a non-Error cause through untouched', () => {
    const wrapper = new Error('wrap', { cause: { code: 'EBADF', detail: 'fd 7' } });
    const out = normaliseThrown(wrapper);
    expect(out.cause).toEqual({ code: 'EBADF', detail: 'fd 7' });
  });

  it('treats a plain string as { name:Error, message:<string> }', () => {
    const out = normaliseThrown('plain rejection');
    expect(out).toEqual({ name: 'Error', message: 'plain rejection' });
  });

  it('extracts message + name + stack from a thrown plain object', () => {
    const out = normaliseThrown({
      name: 'GraphQLError',
      message: 'Unauthorised',
      stack: 'at q (q.js:1:1)',
    });
    expect(out.name).toBe('GraphQLError');
    expect(out.message).toBe('Unauthorised');
    expect(out.stack).toBe('at q (q.js:1:1)');
  });

  it('serialises arbitrary objects without `.message` to JSON', () => {
    const out = normaliseThrown({ code: 422, fieldErrors: ['email'] });
    expect(out.name).toBe('Error');
    expect(out.message).toContain('422');
    expect(out.message).toContain('email');
  });

  it('falls back to String() when JSON serialisation throws (cycle)', () => {
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    const out = normaliseThrown(cyclic);
    expect(out.name).toBe('Error');
    // [object Object] from String() — we don't hard-code the format, just
    // assert we got *something*.
    expect(typeof out.message).toBe('string');
    expect(out.message.length).toBeGreaterThan(0);
  });

  it('handles `null` and `undefined` thrown values', () => {
    expect(normaliseThrown(null)).toEqual({ name: 'Error', message: 'null' });
    expect(normaliseThrown(undefined)).toEqual({ name: 'Error', message: 'unknown' });
  });

  it('truncates an 80 KB stack to <= 8 KB + slice marker', () => {
    const huge = 'x'.repeat(80 * 1024);
    const err = new Error('huge');
    err.stack = huge;
    const out = normaliseThrown(err);
    expect(out.stack).toBeDefined();
    expect(out.stack!.length).toBeLessThanOrEqual(8 * 1024);
  });
});
