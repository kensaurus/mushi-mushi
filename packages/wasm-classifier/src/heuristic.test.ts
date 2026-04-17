import { describe, expect, it } from 'vitest';
import { createHeuristicClassifier } from './heuristic';

describe('heuristic classifier', () => {
  const c = createHeuristicClassifier();

  it('blocks too-short descriptions', async () => {
    const r = await c.classify({ description: 'hi' });
    expect(r.verdict).toBe('block');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('blocks obvious junk patterns', async () => {
    const r = await c.classify({ description: 'aaaaa' });
    expect(r.verdict).toBe('block');
  });

  it('passes a strong bug signal', async () => {
    const r = await c.classify({
      description: 'When I click checkout the page crashes with a 500 error and goes blank',
      hasNetworkErrors: true,
      hasConsoleErrors: true,
    });
    expect(r.verdict).toBe('pass');
    expect(r.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it('returns unsure for ambiguous reports', async () => {
    const r = await c.classify({
      description: 'The page feels a bit slow when I scroll quickly through the timeline',
    });
    expect(['unsure', 'pass']).toContain(r.verdict);
  });

  it('reports modelId and durationMs', async () => {
    const r = await c.classify({ description: 'this is a meaningful bug description' });
    expect(r.modelId).toBe('heuristic-v1');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('counts a screenshot as a positive signal', async () => {
    const without = await c.classify({ description: 'something looks weird here' });
    const withShot = await c.classify({
      description: 'something looks weird here',
      hasScreenshot: true,
      hasSelectedElement: true,
    });
    expect(withShot.confidence).toBeGreaterThan(without.confidence);
  });
});
