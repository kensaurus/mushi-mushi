import { describe, it, expect } from 'vitest';

import { isUuid } from '../../supabase/functions/api/ids.ts';

describe('isUuid', () => {
  it('accepts RFC 4122 UUIDs', () => {
    expect(isUuid('7e664acc-2274-4ccf-b4fa-6d24c1831b20')).toBe(true);
    expect(isUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it('rejects slug-like smoke ids before they hit Postgres', () => {
    expect(isUuid('rep_smoke')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
