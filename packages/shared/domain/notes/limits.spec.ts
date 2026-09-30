import { describe, expect, it } from 'vitest';
import { NOTE_BODY_MAX } from './limits';
import { Entities } from '../../types/entities';

describe('note limits', () => {
  // Spelled out rather than derived so a changed ceiling fails here instead of
  // reaching the API validator and the web counter at once.
  it('caps a note body at 20 000 characters', () => {
    expect(NOTE_BODY_MAX).toBe(20000);
  });

  it('offers exactly two visibilities, private and shared', () => {
    expect(Object.values(Entities.Config.NoteVisibility)).toEqual(['private', 'shared']);
  });
});
