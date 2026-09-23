import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { isJobFailureSuperseded } from './intelligence-priority.ts';

const FAILED_IN_MAY = {
  status: 'failed',
  created_at: '2026-05-19T08:31:48Z',
  finished_at: '2026-05-19T08:31:50Z',
};

Deno.test(
  'a failed job followed by a newer weekly digest is superseded (glot.it, 2026-09-23)',
  () => {
    assertEquals(
      isJobFailureSuperseded(FAILED_IN_MAY, [{ created_at: '2026-09-21T06:00:17Z' }]),
      true,
    );
  },
);

Deno.test('a failed job with no digest after it is still current', () => {
  assertEquals(
    isJobFailureSuperseded(FAILED_IN_MAY, [{ created_at: '2026-05-12T06:00:00Z' }]),
    false,
  );
  assertEquals(isJobFailureSuperseded(FAILED_IN_MAY, []), false);
});

Deno.test('only failures can be superseded', () => {
  const digests = [{ created_at: '2026-09-21T06:00:17Z' }];
  assertEquals(isJobFailureSuperseded({ ...FAILED_IN_MAY, status: 'completed' }, digests), false);
  assertEquals(isJobFailureSuperseded({ ...FAILED_IN_MAY, status: 'running' }, digests), false);
  assertEquals(isJobFailureSuperseded(null, digests), false);
});

Deno.test('compares against when the job finished, falling back to when it was created', () => {
  // Digest written while the job was still running: the failure came after it.
  const duringRun = [{ created_at: '2026-05-19T08:31:49Z' }];
  assertEquals(isJobFailureSuperseded(FAILED_IN_MAY, duringRun), false);
  assertEquals(
    isJobFailureSuperseded({ status: 'failed', created_at: '2026-05-19T08:31:48Z' }, duringRun),
    true,
  );
});

Deno.test('null or unparseable timestamps never supersede', () => {
  assertEquals(isJobFailureSuperseded(FAILED_IN_MAY, [{ created_at: null }]), false);
  assertEquals(
    isJobFailureSuperseded({ status: 'failed', created_at: 'not a date' }, [
      { created_at: '2026-09-21T06:00:17Z' },
    ]),
    false,
  );
});
