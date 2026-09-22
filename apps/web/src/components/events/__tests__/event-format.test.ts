import { describe, it, expect } from 'vitest';
import { formatEventWhen, isPastEvent, mergeEventLists } from '../event-format';

const SAO_PAULO = {
  startsAt: '2026-10-10T13:00:00.000Z',
  endsAt: '2026-10-10T16:00:00.000Z',
  timezone: 'America/Sao_Paulo',
};

describe('formatEventWhen', () => {
  it("renders the instant in the event's own zone, not the machine's", () => {
    const when = formatEventWhen(SAO_PAULO, 'pt-BR');

    // 13:00Z is 10:00 in São Paulo and 15:00 in Berlin. The reader's zone —
    // and the test machine's — must not appear anywhere in the output.
    expect(when.time).toContain('10:00');
    expect(when.time).toContain('13:00');
    expect(when.time).not.toContain('16:00');
  });

  it('renders a single time for an open-ended event, never a guessed range', () => {
    const when = formatEventWhen({ ...SAO_PAULO, endsAt: null }, 'pt-BR');

    expect(when.time).toBe('10:00');
    expect(when.time).not.toContain('–');
  });

  it('names the zone the event is in', () => {
    const tokyo = formatEventWhen({ ...SAO_PAULO, timezone: 'Asia/Tokyo' }, 'en-US');

    expect(tokyo.time).toContain('10:00 PM');
    expect(tokyo.zone).not.toBe('');
  });

  it('falls back to UTC rather than throwing on an unknown zone', () => {
    const when = formatEventWhen({ ...SAO_PAULO, timezone: 'Mars/Olympus_Mons' }, 'en-US');

    expect(when.time).toContain('01:00 PM');
  });
});

describe('mergeEventLists', () => {
  const a = { id: 'a', startsAt: '2026-10-10T13:00:00.000Z' };
  const b = { id: 'b', startsAt: '2026-11-01T13:00:00.000Z' };
  const c = { id: 'c', startsAt: '2026-09-01T13:00:00.000Z' };

  it('never drops what the server already rendered', () => {
    expect(mergeEventLists([a], [], 'upcoming')).toEqual([a]);
  });

  it('unions the entitled superset into the public slice, soonest first', () => {
    expect(mergeEventLists([a], [a, b, c], 'upcoming').map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('orders the past scope most-recent-first', () => {
    expect(mergeEventLists([a], [a, b, c], 'past').map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('de-duplicates by id so one event never appears twice', () => {
    const merged = mergeEventLists([a, b], [b, c], 'upcoming');
    expect(merged).toHaveLength(3);
    expect(new Set(merged.map((e) => e.id)).size).toBe(3);
  });
});

describe('isPastEvent', () => {
  const NOW = Date.parse('2026-10-10T14:00:00.000Z');

  it('is false while the event is still running', () => {
    // Started at 13:00Z, ends at 16:00Z: at 14:00Z it is happening, not past.
    expect(isPastEvent(SAO_PAULO, NOW)).toBe(false);
  });

  it('is true once the declared end has gone by', () => {
    expect(isPastEvent(SAO_PAULO, Date.parse('2026-10-10T16:00:01.000Z'))).toBe(true);
  });

  it('falls back to the start for an open-ended event', () => {
    const openEnded = { startsAt: SAO_PAULO.startsAt, endsAt: null };
    expect(isPastEvent(openEnded, NOW)).toBe(true);
    expect(isPastEvent(openEnded, Date.parse('2026-10-10T12:59:00.000Z'))).toBe(false);
  });

  it('never marks an event past on an unparseable instant', () => {
    // A wrongly stamped "already happened" on a live seminar costs a booking;
    // a missing marker on a dead one costs nothing.
    expect(isPastEvent({ startsAt: 'not-a-date', endsAt: null }, NOW)).toBe(false);
  });
});
