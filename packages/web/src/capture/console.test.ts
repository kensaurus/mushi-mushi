import { describe, it, expect, afterEach } from 'vitest';
import { createConsoleCapture } from './console';

describe('createConsoleCapture', () => {
  let capture: ReturnType<typeof createConsoleCapture>;

  afterEach(() => {
    capture?.destroy();
  });

  it('captures console.log messages', () => {
    capture = createConsoleCapture();
    console.log('test message');
    const entries = capture.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('log');
    expect(entries[0].message).toBe('test message');
  });

  it('captures console.warn messages', () => {
    capture = createConsoleCapture();
    console.warn('warning here');
    const entries = capture.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('warn');
  });

  it('captures console.error messages', () => {
    capture = createConsoleCapture();
    console.error('error happened');
    const entries = capture.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe('error');
  });

  it('stores timestamps', () => {
    capture = createConsoleCapture();
    const before = Date.now();
    console.log('timed');
    const entries = capture.getEntries();
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
  });

  it('respects ring buffer limit (max 50)', () => {
    capture = createConsoleCapture();
    for (let i = 0; i < 60; i++) {
      console.log(`msg ${i}`);
    }
    const entries = capture.getEntries();
    expect(entries.length).toBe(50);
    expect(entries[0].message).toBe('msg 10');
  });

  it('clear removes all entries', () => {
    capture = createConsoleCapture();
    console.log('will be cleared');
    capture.clear();
    expect(capture.getEntries().length).toBe(0);
  });

  it('destroy restores original console methods', () => {
    const originalLog = console.log;
    capture = createConsoleCapture();
    expect(console.log).not.toBe(originalLog);
    capture.destroy();
    expect(console.log).toBe(originalLog);
  });

  it('truncates long messages to 500 chars', () => {
    capture = createConsoleCapture();
    console.log('x'.repeat(1000));
    const entries = capture.getEntries();
    expect(entries[0].message.length).toBeLessThanOrEqual(500);
  });

  it('serializes objects in messages', () => {
    capture = createConsoleCapture();
    console.log('data:', { key: 'value' });
    const entries = capture.getEntries();
    expect(entries[0].message).toContain('"key"');
    expect(entries[0].message).toContain('"value"');
  });
});
