import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceDraw, journeyRecordingDecision, readTabOptIn } from './journey-recording';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const open = { recordUntil: '2026-11-14T12:00:00Z', sampleRate: 0.1 };

describe('journeyRecordingDecision', () => {
  it('keeps the old meaning of true, undefined and false', () => {
    expect(journeyRecordingDecision({ mode: undefined, tabOptIn: false, window: null, draw: 0.9, now: NOW })).toBe(true);
    expect(journeyRecordingDecision({ mode: true, tabOptIn: false, window: null, draw: 0.9, now: NOW })).toBe(true);
    expect(journeyRecordingDecision({ mode: false, tabOptIn: true, window: open, draw: 0, now: NOW })).toBe(false);
  });

  it('records nobody on demand until asked', () => {
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: false, window: null, draw: 0, now: NOW })).toBe(false);
  });

  it('records a tab that opted in, window or not', () => {
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: true, window: null, draw: 0.99, now: NOW })).toBe(true);
  });

  it('records the sampled share while the window is open, nobody after', () => {
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: false, window: open, draw: 0.05, now: NOW })).toBe(true);
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: false, window: open, draw: 0.5, now: NOW })).toBe(false);
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: false, window: open, draw: 0.05, now: Date.parse('2026-11-15T00:00:00Z') })).toBe(false);
    expect(journeyRecordingDecision({ mode: 'on-demand', tabOptIn: false, window: { recordUntil: 'nope', sampleRate: 1 }, draw: 0, now: NOW })).toBe(false);
  });
});

describe('readTabOptIn and deviceDraw', () => {
  const P = 'proj-1';
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('turns on for the tab with ?mushi_journeys=1, keeps it, and turns off with =0', () => {
    expect(readTabOptIn(P)).toBe(false);
    window.history.replaceState(null, '', '/pricing?mushi_journeys=1');
    expect(readTabOptIn(P)).toBe(true);
    window.history.replaceState(null, '', '/next-page');
    expect(readTabOptIn(P)).toBe(true);
    window.history.replaceState(null, '', '/x?mushi_journeys=0');
    expect(readTabOptIn(P)).toBe(false);
  });

  it('draws once per device and keeps the number', () => {
    const first = deviceDraw(P, () => 0.42);
    expect(first).toBe(0.42);
    expect(deviceDraw(P, () => 0.9)).toBe(0.42);
    expect(deviceDraw('other', () => 0.9)).toBe(0.9);
  });
});
