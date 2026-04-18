import { describe, it, expect } from 'vitest';
import { ROLES } from '@arenaquest/shared';

describe('Shared Roles Constants', () => {
  it('should have exactly 4 roles defined', () => {
    const roleKeys = Object.keys(ROLES);
    expect(roleKeys).toHaveLength(4);
    
    expect(ROLES.ADMIN).toBe('admin');
    expect(ROLES.CONTENT_CREATOR).toBe('content_creator');
    expect(ROLES.TUTOR).toBe('tutor');
    expect(ROLES.STUDENT).toBe('student');
  });
});
