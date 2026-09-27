import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EVENT_TIMEZONE,
  instantToWallTime,
  wallTimeToInstant,
} from '@web/components/admin/events/event-datetime';
import { slugifyTitle } from '@web/components/admin/events/event-slug';

describe('wallTimeToInstant', () => {
  it('reads the typed time in the event zone, not the browser zone', () => {
    // São Paulo has been fixed at UTC-3 since 2019.
    expect(wallTimeToInstant('2026-10-10T10:00', DEFAULT_EVENT_TIMEZONE)).toBe(
      '2026-10-10T13:00:00.000Z',
    );
  });

  it('honours a different zone for the same wall time', () => {
    expect(wallTimeToInstant('2026-10-10T10:00', 'UTC')).toBe('2026-10-10T10:00:00.000Z');
    expect(wallTimeToInstant('2026-01-15T10:00', 'Europe/Lisbon')).toBe(
      '2026-01-15T10:00:00.000Z',
    );
    // …and the same zone in summer time, which the two-pass offset resolves.
    expect(wallTimeToInstant('2026-07-15T10:00', 'Europe/Lisbon')).toBe(
      '2026-07-15T09:00:00.000Z',
    );
  });

  it('returns null for an empty or malformed value instead of Invalid Date', () => {
    expect(wallTimeToInstant('', DEFAULT_EVENT_TIMEZONE)).toBeNull();
    expect(wallTimeToInstant('not a date', DEFAULT_EVENT_TIMEZONE)).toBeNull();
  });

  it('degrades an unknown zone to UTC rather than throwing on every keystroke', () => {
    expect(wallTimeToInstant('2026-10-10T10:00', 'Mars/Olympus')).toBe(
      '2026-10-10T10:00:00.000Z',
    );
  });
});

describe('instantToWallTime', () => {
  it('round-trips an untouched value', () => {
    const wall = instantToWallTime('2026-10-10T13:00:00.000Z', DEFAULT_EVENT_TIMEZONE);
    expect(wall).toBe('2026-10-10T10:00');
    expect(wallTimeToInstant(wall, DEFAULT_EVENT_TIMEZONE)).toBe('2026-10-10T13:00:00.000Z');
  });
});

describe('slugifyTitle', () => {
  it('folds accents rather than dropping them', () => {
    expect(slugifyTitle('Graduação de Outubro')).toBe('graduacao-de-outubro');
    expect(slugifyTitle('Chūdan · Jō')).toBe('chudan-jo');
  });

  it('trims separators and collapses runs', () => {
    expect(slugifyTitle('  Treino   aberto!!  ')).toBe('treino-aberto');
  });

  it('stays inside the 120-character limit the API accepts', () => {
    expect(slugifyTitle('a'.repeat(200)).length).toBeLessThanOrEqual(120);
  });
});
