import { describe, expect, it } from 'vitest';

import { isFreshDatabaseError } from '../../scripts/check-no-dev-seed';

describe('isFreshDatabaseError', () => {
  it('recognizes a newly provisioned database without users', () => {
    expect(isFreshDatabaseError('no such table: users: SQLITE_ERROR')).toBe(true);
  });

  it('does not hide unrelated Wrangler failures', () => {
    expect(isFreshDatabaseError('Authentication failed')).toBe(false);
    expect(isFreshDatabaseError('no such table: topics')).toBe(false);
  });
});
