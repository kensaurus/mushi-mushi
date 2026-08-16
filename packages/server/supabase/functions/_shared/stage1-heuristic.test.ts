import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { heuristicStage1Classification, normalizeStage1Category } from './stage1-heuristic.ts';

Deno.test('normalizeStage1Category maps known slugs and aliases', () => {
  assertEquals(normalizeStage1Category('bug'), 'bug');
  assertEquals(normalizeStage1Category('SLOW'), 'slow');
  assertEquals(normalizeStage1Category('layout shift'), 'visual');
  assertEquals(normalizeStage1Category('confusing copy'), 'confusing');
  assertEquals(normalizeStage1Category('something else'), 'other');
});

Deno.test('heuristicStage1Classification uses description and intent', () => {
  const result = heuristicStage1Classification({
    description: 'Checkout button does nothing',
    user_category: 'bug',
    user_intent: 'Complete purchase',
    console_logs: [{ level: 'error', message: 'TypeError: submit of null' }],
    network_logs: [{ status: 500, error: 'failed' }],
  });
  assertEquals(result.category, 'bug');
  assertEquals(result.severity, 'high');
  assertEquals(result.symptom.includes('Checkout'), true);
  assertEquals(result.action, 'Complete purchase');
  assertEquals(result.emotion, '');
  assertEquals(result.confidence < 0.85, true);
});

Deno.test('heuristicStage1Classification marks critical on crash/data-loss copy', () => {
  const result = heuristicStage1Classification({
    description: 'Payment failed and caused data loss',
    user_category: 'bug',
  });
  assertEquals(result.severity, 'critical');
});

Deno.test('heuristicStage1Classification defaults empty reports without throwing', () => {
  const result = heuristicStage1Classification({});
  assertEquals(result.category, 'other');
  assertEquals(result.symptom, 'No description provided');
  assertEquals(result.action, 'Using the app');
});
