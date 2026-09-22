import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  D1EventRepository,
  deriveEventSlug,
  anonymousVisibleSql,
  authenticatedVisibleSql,
} from '@api/adapters/db/d1-event-repository';
import type { CreateEventInput } from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';
import { applyMigrations } from '../helpers/apply-migrations';

/**
 * The audience matrix below is the point of this suite. Every cell is asserted
 * explicitly rather than folded into one "returns the right set" test, because
 * the failure being guarded against is a single audience level leaking to a
 * single viewer class, and a collapsed assertion hides exactly that.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('D1EventRepository', () => {
  let repo: D1EventRepository;
  let adminId: string;
  let memberNoGrantId: string;
  let memberDirectId: string;
  let memberGroupId: string;
  let groupId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    // Foreign keys are off by default in the Miniflare D1; the cascade tests
    // below would pass vacuously without this.
    await env.DB.exec('PRAGMA foreign_keys = ON');
    repo = new D1EventRepository(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM events').run();

    adminId = crypto.randomUUID();
    memberNoGrantId = crypto.randomUUID();
    memberDirectId = crypto.randomUUID();
    memberGroupId = crypto.randomUUID();
    groupId = crypto.randomUUID();

    await env.DB.batch([
      ...[adminId, memberNoGrantId, memberDirectId, memberGroupId].map(id =>
        env.DB
          .prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
          .bind(id, 'Test', `u-${id}@example.com`, 'hash'),
      ),
      env.DB.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').bind(groupId, `grp-${groupId}`),
      env.DB
        .prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)')
        .bind(groupId, memberGroupId),
    ]);
  });

  function makeEvent(overrides: Partial<CreateEventInput> = {}): Promise<Awaited<ReturnType<D1EventRepository['create']>>> {
    return repo.create({
      slug: '',
      title: 'Untitled event',
      startsAt: new Date(NOW.getTime() + 7 * DAY),
      createdBy: adminId,
      status: Entities.Config.EventStatus.PUBLISHED,
      ...overrides,
    });
  }

  // ===========================================================================
  // The anonymous branch is a constant, not a parameter
  // ===========================================================================

  describe('anonymous statement shape', () => {
    // The matrix below would still pass if somebody merged the two branches and
    // bound the audience. These assertions would not.
    for (const scope of ['upcoming', 'past'] as const) {
      it(`filters on a literal published + public audience (${scope})`, () => {
        const sql = anonymousVisibleSql(scope);
        expect(sql).toContain("status = 'published' AND audience = 'public'");
        // No grant resolution, so no user id can reach this statement at all.
        expect(sql).not.toContain('event_audience_user');
        expect(sql).not.toContain('event_audience_group');
        expect(sql).not.toContain('user_group_members');
      });

      it(`is a different statement from the authenticated one (${scope})`, () => {
        expect(anonymousVisibleSql(scope)).not.toBe(authenticatedVisibleSql(scope));
        expect(authenticatedVisibleSql(scope)).toContain('event_audience_user');
      });
    }
  });

  // ===========================================================================
  // Audience matrix
  // ===========================================================================

  describe('audience matrix', () => {
    let publicId: string;
    let membersId: string;
    let restrictedDirectId: string;
    let restrictedGroupId: string;
    let restrictedNoneId: string;
    let draftId: string;
    let archivedId: string;

    beforeEach(async () => {
      const pub = await makeEvent({ title: 'Open class', slug: 'open-class', audience: Entities.Config.EventAudience.PUBLIC });
      const mem = await makeEvent({ title: 'Members only', slug: 'members-only', audience: Entities.Config.EventAudience.MEMBERS });
      const rDirect = await makeEvent({ title: 'Direct grant', slug: 'direct-grant', audience: Entities.Config.EventAudience.RESTRICTED });
      const rGroup = await makeEvent({ title: 'Group grant', slug: 'group-grant', audience: Entities.Config.EventAudience.RESTRICTED });
      const rNone = await makeEvent({ title: 'Nobody', slug: 'nobody', audience: Entities.Config.EventAudience.RESTRICTED });
      const draft = await makeEvent({ title: 'Draft', slug: 'draft-event', audience: Entities.Config.EventAudience.PUBLIC, status: Entities.Config.EventStatus.DRAFT });
      const archived = await makeEvent({ title: 'Archived', slug: 'archived-event', audience: Entities.Config.EventAudience.PUBLIC, status: Entities.Config.EventStatus.ARCHIVED });

      publicId = pub.id;
      membersId = mem.id;
      restrictedDirectId = rDirect.id;
      restrictedGroupId = rGroup.id;
      restrictedNoneId = rNone.id;
      draftId = draft.id;
      archivedId = archived.id;

      await repo.replaceAudienceGrants(restrictedDirectId, { groupIds: [], userIds: [memberDirectId] });
      await repo.replaceAudienceGrants(restrictedGroupId, { groupIds: [groupId], userIds: [] });
    });

    async function visibleIds(viewerUserId: string | null): Promise<string[]> {
      const events = await repo.listVisible({ viewerUserId, now: NOW });
      return events.map(e => e.id).sort();
    }

    it('anonymous sees the published public event and nothing else', async () => {
      expect(await visibleIds(null)).toEqual([publicId]);
      expect(await repo.countVisible({ viewerUserId: null, now: NOW })).toBe(1);
    });

    it('anonymous does not see members, restricted, draft or archived', async () => {
      const ids = await visibleIds(null);
      expect(ids).not.toContain(membersId);
      expect(ids).not.toContain(restrictedDirectId);
      expect(ids).not.toContain(restrictedGroupId);
      expect(ids).not.toContain(restrictedNoneId);
      expect(ids).not.toContain(draftId);
      expect(ids).not.toContain(archivedId);
    });

    it('a member with no grant sees public and members only', async () => {
      expect(await visibleIds(memberNoGrantId)).toEqual([publicId, membersId].sort());
      expect(await repo.countVisible({ viewerUserId: memberNoGrantId, now: NOW })).toBe(2);
    });

    it('a directly granted member sees public, members and that restricted event', async () => {
      expect(await visibleIds(memberDirectId)).toEqual(
        [publicId, membersId, restrictedDirectId].sort(),
      );
    });

    it('a group-granted member sees public, members and the group restricted event', async () => {
      expect(await visibleIds(memberGroupId)).toEqual(
        [publicId, membersId, restrictedGroupId].sort(),
      );
    });

    it('a grant to one viewer does not reach the other', async () => {
      expect(await visibleIds(memberDirectId)).not.toContain(restrictedGroupId);
      expect(await visibleIds(memberGroupId)).not.toContain(restrictedDirectId);
    });

    it('no viewer sees the ungranted restricted event, the draft or the archived one', async () => {
      for (const viewer of [null, memberNoGrantId, memberDirectId, memberGroupId]) {
        const ids = await visibleIds(viewer);
        expect(ids).not.toContain(restrictedNoneId);
        expect(ids).not.toContain(draftId);
        expect(ids).not.toContain(archivedId);
      }
    });

    // -- slug lookup obeys the same rule -------------------------------------

    it('findVisibleBySlug resolves exactly what listVisible returns, per viewer', async () => {
      const cases: Array<[string | null, string[], string[]]> = [
        [null, ['open-class'], ['members-only', 'direct-grant', 'group-grant', 'nobody', 'draft-event', 'archived-event']],
        [memberNoGrantId, ['open-class', 'members-only'], ['direct-grant', 'group-grant', 'nobody', 'draft-event', 'archived-event']],
        [memberDirectId, ['open-class', 'members-only', 'direct-grant'], ['group-grant', 'nobody', 'draft-event', 'archived-event']],
        [memberGroupId, ['open-class', 'members-only', 'group-grant'], ['direct-grant', 'nobody', 'draft-event', 'archived-event']],
      ];

      for (const [viewerUserId, visible, hidden] of cases) {
        for (const slug of visible) {
          expect(await repo.findVisibleBySlug(slug, { viewerUserId })).not.toBeNull();
        }
        for (const slug of hidden) {
          // null, not a refusal: the caller answers 404 either way, so the
          // public surface is not an enumeration oracle.
          expect(await repo.findVisibleBySlug(slug, { viewerUserId })).toBeNull();
        }
      }
    });

    it('findVisibleBySlug returns null for an absent slug, exactly as for a hidden one', async () => {
      expect(await repo.findVisibleBySlug('no-such-event', { viewerUserId: null })).toBeNull();
      expect(await repo.findVisibleBySlug('nobody', { viewerUserId: null })).toBeNull();
    });

    it('an empty string viewer id is treated as anonymous, not as a user', async () => {
      const events = await repo.listVisible({ viewerUserId: '', now: NOW });
      expect(events.map(e => e.id)).toEqual([publicId]);
    });

    // -- the admin surface bypasses all of it --------------------------------

    it('listAll returns every event regardless of status or audience', async () => {
      const all = await repo.listAll({ limit: 100 });
      expect(all.map(e => e.id).sort()).toEqual(
        [publicId, membersId, restrictedDirectId, restrictedGroupId, restrictedNoneId, draftId, archivedId].sort(),
      );
      expect(await repo.countAll()).toBe(7);
    });

    it('listAll filters by status when asked', async () => {
      const drafts = await repo.listAll({ status: Entities.Config.EventStatus.DRAFT });
      expect(drafts.map(e => e.id)).toEqual([draftId]);
      expect(await repo.countAll({ status: Entities.Config.EventStatus.DRAFT })).toBe(1);
    });

    it('reading both scopes writes no row', async () => {
      const before = await env.DB
        .prepare('SELECT id, updated_at FROM events ORDER BY id')
        .all<{ id: string; updated_at: string }>();

      await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'past' });
      await repo.listVisible({ viewerUserId: memberDirectId, now: NOW, scope: 'upcoming' });
      await repo.listVisible({ viewerUserId: memberDirectId, now: NOW, scope: 'past' });
      await repo.findVisibleBySlug('open-class', { viewerUserId: null });

      const after = await env.DB
        .prepare('SELECT id, updated_at FROM events ORDER BY id')
        .all<{ id: string; updated_at: string }>();

      expect(after.results).toEqual(before.results);
    });
  });

  // ===========================================================================
  // Scope: "past" is computed, never stored
  // ===========================================================================

  describe('scope predicate', () => {
    it('places an event with an explicit end on the correct side of now', async () => {
      const finished = await makeEvent({
        title: 'Finished',
        startsAt: new Date(NOW.getTime() - 2 * DAY),
        endsAt: new Date(NOW.getTime() - 1000),
        audience: Entities.Config.EventAudience.PUBLIC,
      });
      const running = await makeEvent({
        title: 'Running',
        startsAt: new Date(NOW.getTime() - 2 * DAY),
        endsAt: new Date(NOW.getTime() + 1000),
        audience: Entities.Config.EventAudience.PUBLIC,
      });

      const upcoming = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      const past = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'past' });

      expect(upcoming.map(e => e.id)).toEqual([running.id]);
      expect(past.map(e => e.id)).toEqual([finished.id]);
    });

    it('treats the exact boundary instant as still upcoming', async () => {
      const onTheLine = await makeEvent({
        title: 'On the line',
        startsAt: new Date(NOW.getTime() - DAY),
        endsAt: NOW,
        audience: Entities.Config.EventAudience.PUBLIC,
      });

      const upcoming = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      const past = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'past' });

      expect(upcoming.map(e => e.id)).toEqual([onTheLine.id]);
      expect(past).toEqual([]);
    });

    it('expires an open-ended event exactly one day after it starts', async () => {
      // ends_at IS NULL, so the predicate falls back to starts_at + 1 day.
      const stillOn = await makeEvent({
        title: 'Open ended, still on',
        startsAt: new Date(NOW.getTime() - 23 * 60 * 60 * 1000),
        endsAt: null,
        audience: Entities.Config.EventAudience.PUBLIC,
      });
      const expired = await makeEvent({
        title: 'Open ended, expired',
        startsAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
        endsAt: null,
        audience: Entities.Config.EventAudience.PUBLIC,
      });

      const upcoming = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      const past = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'past' });

      expect(upcoming.map(e => e.id)).toEqual([stillOn.id]);
      expect(past.map(e => e.id)).toEqual([expired.id]);
    });

    it('the same row moves between the lists as the clock passes it, with no write', async () => {
      const event = await makeEvent({
        title: 'Crossing',
        startsAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000),
        endsAt: null,
        audience: Entities.Config.EventAudience.PUBLIC,
      });

      const before = await env.DB
        .prepare('SELECT updated_at FROM events WHERE id = ?')
        .bind(event.id)
        .first<{ updated_at: string }>();

      const earlier = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      const later = await repo.listVisible({
        viewerUserId: null,
        now: new Date(NOW.getTime() + 2 * DAY),
        scope: 'past',
      });

      expect(earlier.map(e => e.id)).toEqual([event.id]);
      expect(later.map(e => e.id)).toEqual([event.id]);

      const after = await env.DB
        .prepare('SELECT updated_at FROM events WHERE id = ?')
        .bind(event.id)
        .first<{ updated_at: string }>();
      expect(after?.updated_at).toBe(before?.updated_at);
    });

    it('orders upcoming ascending and past descending', async () => {
      const soon = await makeEvent({ title: 'Soon', startsAt: new Date(NOW.getTime() + DAY), audience: Entities.Config.EventAudience.PUBLIC });
      const later = await makeEvent({ title: 'Later', startsAt: new Date(NOW.getTime() + 5 * DAY), audience: Entities.Config.EventAudience.PUBLIC });
      const recent = await makeEvent({ title: 'Recent', startsAt: new Date(NOW.getTime() - 3 * DAY), audience: Entities.Config.EventAudience.PUBLIC });
      const old = await makeEvent({ title: 'Old', startsAt: new Date(NOW.getTime() - 30 * DAY), audience: Entities.Config.EventAudience.PUBLIC });

      const upcoming = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'upcoming' });
      const past = await repo.listVisible({ viewerUserId: null, now: NOW, scope: 'past' });

      expect(upcoming.map(e => e.id)).toEqual([soon.id, later.id]);
      expect(past.map(e => e.id)).toEqual([recent.id, old.id]);
    });

    it('defaults to the upcoming scope', async () => {
      await makeEvent({ title: 'Gone', startsAt: new Date(NOW.getTime() - 30 * DAY), audience: Entities.Config.EventAudience.PUBLIC });
      const here = await makeEvent({ title: 'Here', startsAt: new Date(NOW.getTime() + DAY), audience: Entities.Config.EventAudience.PUBLIC });

      const events = await repo.listVisible({ viewerUserId: null, now: NOW });
      expect(events.map(e => e.id)).toEqual([here.id]);
    });

    it('applies the scope to an authenticated reader too', async () => {
      const pastMembers = await makeEvent({
        title: 'Past members',
        startsAt: new Date(NOW.getTime() - 30 * DAY),
        audience: Entities.Config.EventAudience.MEMBERS,
      });

      const upcoming = await repo.listVisible({ viewerUserId: memberNoGrantId, now: NOW, scope: 'upcoming' });
      const past = await repo.listVisible({ viewerUserId: memberNoGrantId, now: NOW, scope: 'past' });

      expect(upcoming).toEqual([]);
      expect(past.map(e => e.id)).toEqual([pastMembers.id]);
      expect(await repo.countVisible({ viewerUserId: memberNoGrantId, now: NOW, scope: 'past' })).toBe(1);
    });

    it('findVisibleBySlug ignores the scope: a past event still has a page', async () => {
      await makeEvent({
        title: 'Last year',
        slug: 'last-year',
        startsAt: new Date(NOW.getTime() - 365 * DAY),
        audience: Entities.Config.EventAudience.PUBLIC,
      });

      expect(await repo.findVisibleBySlug('last-year', { viewerUserId: null })).not.toBeNull();
    });
  });

  // ===========================================================================
  // Date <-> TEXT
  // ===========================================================================

  describe('date storage', () => {
    it('stores a SQLite-parseable canonical UTC form and round-trips it', async () => {
      const startsAt = new Date('2026-03-14T19:30:00.000Z');
      const endsAt = new Date('2026-03-14T22:45:00.000Z');
      const event = await makeEvent({ title: 'Round trip', startsAt, endsAt });

      const raw = await env.DB
        .prepare(
          `SELECT starts_at, ends_at,
                  datetime(starts_at, '+1 day') AS plus_one,
                  datetime(starts_at) AS parsed
             FROM events WHERE id = ?`,
        )
        .bind(event.id)
        .first<{ starts_at: string; ends_at: string; plus_one: string; parsed: string }>();

      // The stored shape is asserted, not assumed: datetime() returns NULL for
      // anything it cannot parse, which would silently drop the row from both
      // scope lists rather than fail.
      expect(raw?.starts_at).toBe('2026-03-14 19:30:00');
      expect(raw?.ends_at).toBe('2026-03-14 22:45:00');
      expect(raw?.parsed).toBe('2026-03-14 19:30:00');
      expect(raw?.plus_one).toBe('2026-03-15 19:30:00');

      const read = await repo.findById(event.id);
      expect(read?.startsAt.toISOString()).toBe('2026-03-14T19:30:00.000Z');
      expect(read?.endsAt?.toISOString()).toBe('2026-03-14T22:45:00.000Z');
    });

    it('maps a null ends_at to null rather than an Invalid Date', async () => {
      const event = await makeEvent({ title: 'No end', endsAt: null });
      const read = await repo.findById(event.id);
      expect(read?.endsAt).toBeNull();
    });

    it('parses the datetime() defaults written by the schema', async () => {
      const event = await makeEvent({ title: 'Timestamps' });
      const read = await repo.findById(event.id);
      expect(Number.isNaN(read!.createdAt.getTime())).toBe(false);
      expect(Number.isNaN(read!.updatedAt.getTime())).toBe(false);
    });
  });

  // ===========================================================================
  // Slug
  // ===========================================================================

  describe('slug', () => {
    it('derives a slug from the title', async () => {
      const event = await makeEvent({ title: 'Seminário de Março — Faixa Preta!' });
      expect(event.slug).toBe('seminario-de-marco-faixa-preta');
      expect(deriveEventSlug('Seminário de Março — Faixa Preta!')).toBe('seminario-de-marco-faixa-preta');
    });

    it('gives two events created from the same title distinct slugs', async () => {
      const first = await makeEvent({ title: 'Winter Camp' });
      const second = await makeEvent({ title: 'Winter Camp' });
      const third = await makeEvent({ title: 'Winter Camp' });

      expect(first.slug).toBe('winter-camp');
      expect(second.slug).toBe('winter-camp-2');
      expect(third.slug).toBe('winter-camp-3');
      expect(new Set([first.slug, second.slug, third.slug]).size).toBe(3);
    });

    it('honours an explicit slug, and suffixes it when it is taken', async () => {
      const first = await makeEvent({ title: 'Anything', slug: 'my-chosen-slug' });
      const second = await makeEvent({ title: 'Anything else', slug: 'my-chosen-slug' });

      expect(first.slug).toBe('my-chosen-slug');
      expect(second.slug).toBe('my-chosen-slug-2');
    });

    it('never re-derives the slug when the title changes', async () => {
      const event = await makeEvent({ title: 'Original Title' });
      expect(event.slug).toBe('original-title');

      const updated = await repo.update(event.id, { title: 'A Completely Different Title' });

      // A link already pasted into a WhatsApp group has to keep working.
      expect(updated.title).toBe('A Completely Different Title');
      expect(updated.slug).toBe('original-title');
    });

    it('moves the slug only when one is explicitly supplied to update', async () => {
      const event = await makeEvent({ title: 'Original Title' });
      const updated = await repo.update(event.id, { slug: 'hand-picked' });
      expect(updated.slug).toBe('hand-picked');
    });

    it('falls back to a usable slug when the title has no slugifiable characters', async () => {
      const event = await makeEvent({ title: '!!!' });
      expect(event.slug).toBe('event');
    });
  });

  // ===========================================================================
  // Create / update / delete
  // ===========================================================================

  describe('create and update', () => {
    it('applies the schema defaults when create omits status and audience', async () => {
      const event = await repo.create({
        slug: '',
        title: 'Quiet by default',
        startsAt: new Date(NOW.getTime() + DAY),
        createdBy: adminId,
      });

      expect(event.status).toBe('draft');
      expect(event.audience).toBe('members');
      expect(event.timezone).toBe('America/Sao_Paulo');
      expect(event.flyer.status).toBe('none');
      expect(event.summary).toBe('');
      expect(event.content).toBe('');
      expect(event.whatsappNumber).toBe('');
      expect(event.whatsappMessage).toBeNull();
      expect(event.contactLabel).toBe('');
      expect(event.createdBy).toBe(adminId);
    });

    it('persists every editable field', async () => {
      const event = await makeEvent({
        title: 'Full house',
        summary: 'A blurb',
        content: '# Heading',
        location: 'Dojo',
        timezone: 'Europe/Lisbon',
        whatsappNumber: '5511999999999',
        whatsappMessage: 'Hi about the seminar',
        contactLabel: 'Talk to Sensei',
      });

      const read = await repo.findById(event.id);
      expect(read).toMatchObject({
        title: 'Full house',
        summary: 'A blurb',
        content: '# Heading',
        location: 'Dojo',
        timezone: 'Europe/Lisbon',
        whatsappNumber: '5511999999999',
        whatsappMessage: 'Hi about the seminar',
        contactLabel: 'Talk to Sensei',
      });
    });

    it('leaves omitted columns untouched on update', async () => {
      const event = await makeEvent({ title: 'Keep me', summary: 'Keep this summary' });
      const updated = await repo.update(event.id, { location: 'New place' });

      expect(updated.summary).toBe('Keep this summary');
      expect(updated.location).toBe('New place');
      expect(updated.title).toBe('Keep me');
    });

    it('can clear ends_at back to null through update', async () => {
      const event = await makeEvent({ title: 'Had an end', endsAt: new Date(NOW.getTime() + 8 * DAY) });
      expect(event.endsAt).not.toBeNull();

      const updated = await repo.update(event.id, { endsAt: null });
      expect(updated.endsAt).toBeNull();
    });

    it('honours an explicit id', async () => {
      const id = crypto.randomUUID();
      const event = await makeEvent({ id, title: 'Given id' });
      expect(event.id).toBe(id);
    });

    it('findBySlug ignores status and audience', async () => {
      const draft = await makeEvent({
        title: 'Hidden draft',
        slug: 'hidden-draft',
        status: Entities.Config.EventStatus.DRAFT,
        audience: Entities.Config.EventAudience.RESTRICTED,
      });

      expect((await repo.findBySlug('hidden-draft'))?.id).toBe(draft.id);
      expect(await repo.findVisibleBySlug('hidden-draft', { viewerUserId: memberNoGrantId })).toBeNull();
    });

    it('delete removes the event', async () => {
      const event = await makeEvent({ title: 'Doomed' });
      await repo.delete(event.id);
      expect(await repo.findById(event.id)).toBeNull();
    });
  });

  // ===========================================================================
  // Audience grants
  // ===========================================================================

  describe('audience grants', () => {
    it('round-trips a grant set', async () => {
      const event = await makeEvent({ title: 'Granted', audience: Entities.Config.EventAudience.RESTRICTED });
      await repo.replaceAudienceGrants(event.id, {
        groupIds: [groupId],
        userIds: [memberDirectId],
      });

      const grants = await repo.getAudienceGrants(event.id);
      expect(grants.groupIds).toEqual([groupId]);
      expect(grants.userIds).toEqual([memberDirectId]);
    });

    it('is whole-set: replacing revokes what the new set omits', async () => {
      const event = await makeEvent({ title: 'Revoked', audience: Entities.Config.EventAudience.RESTRICTED });
      await repo.replaceAudienceGrants(event.id, {
        groupIds: [groupId],
        userIds: [memberDirectId, memberNoGrantId],
      });
      expect(await repo.listVisible({ viewerUserId: memberDirectId, now: NOW })).toHaveLength(1);

      await repo.replaceAudienceGrants(event.id, { groupIds: [], userIds: [memberNoGrantId] });

      const grants = await repo.getAudienceGrants(event.id);
      expect(grants.groupIds).toEqual([]);
      expect(grants.userIds).toEqual([memberNoGrantId]);

      // The revoked reader loses the event immediately; the kept one keeps it.
      expect(await repo.listVisible({ viewerUserId: memberDirectId, now: NOW })).toEqual([]);
      expect(await repo.listVisible({ viewerUserId: memberGroupId, now: NOW })).toEqual([]);
      expect((await repo.listVisible({ viewerUserId: memberNoGrantId, now: NOW })).map(e => e.id)).toEqual([event.id]);
    });

    it('clears every grant when handed an empty set', async () => {
      const event = await makeEvent({ title: 'Emptied', audience: Entities.Config.EventAudience.RESTRICTED });
      await repo.replaceAudienceGrants(event.id, { groupIds: [groupId], userIds: [memberDirectId] });
      await repo.replaceAudienceGrants(event.id, { groupIds: [], userIds: [] });

      expect(await repo.getAudienceGrants(event.id)).toEqual({ groupIds: [], userIds: [] });
    });

    it('deleting a group removes its grant without deleting the event', async () => {
      const event = await makeEvent({ title: 'Group grant', audience: Entities.Config.EventAudience.RESTRICTED });
      await repo.replaceAudienceGrants(event.id, { groupIds: [groupId], userIds: [] });
      expect((await repo.listVisible({ viewerUserId: memberGroupId, now: NOW })).map(e => e.id)).toEqual([event.id]);

      await env.DB.prepare('DELETE FROM user_groups WHERE id = ?').bind(groupId).run();

      expect(await repo.findById(event.id)).not.toBeNull();
      expect(await repo.getAudienceGrants(event.id)).toEqual({ groupIds: [], userIds: [] });
      expect(await repo.listVisible({ viewerUserId: memberGroupId, now: NOW })).toEqual([]);
    });

    it('deleting a user removes their grant without deleting the event', async () => {
      const event = await makeEvent({ title: 'User grant', audience: Entities.Config.EventAudience.RESTRICTED });
      await repo.replaceAudienceGrants(event.id, { groupIds: [], userIds: [memberDirectId] });

      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(memberDirectId).run();

      expect(await repo.findById(event.id)).not.toBeNull();
      expect(await repo.getAudienceGrants(event.id)).toEqual({ groupIds: [], userIds: [] });
    });

    it('a grant confers no visibility on a draft or archived event', async () => {
      const draft = await makeEvent({
        title: 'Granted draft',
        audience: Entities.Config.EventAudience.RESTRICTED,
        status: Entities.Config.EventStatus.DRAFT,
      });
      await repo.replaceAudienceGrants(draft.id, { groupIds: [groupId], userIds: [memberDirectId] });

      expect(await repo.listVisible({ viewerUserId: memberDirectId, now: NOW })).toEqual([]);
      expect(await repo.listVisible({ viewerUserId: memberGroupId, now: NOW })).toEqual([]);
    });
  });

  // ===========================================================================
  // Flyer columns
  // ===========================================================================

  describe('flyer', () => {
    const flyer = {
      key: 'events/one/abc-flyer.png',
      type: 'image/png',
      sizeBytes: 1234,
      name: 'flyer.png',
    };

    it('records a presigned upload as pending', async () => {
      const event = await makeEvent({ title: 'Flyer pending' });
      await repo.setFlyerPending(event.id, flyer);

      const read = await repo.findById(event.id);
      expect(read?.flyer).toEqual({
        status: 'pending',
        key: flyer.key,
        type: flyer.type,
        sizeBytes: flyer.sizeBytes,
        name: flyer.name,
      });
    });

    it('confirms an upload and reports no replaced key on the first flyer', async () => {
      const event = await makeEvent({ title: 'First flyer' });
      await repo.setFlyerPending(event.id, flyer);

      const replaced = await repo.setFlyerReady(event.id, { sizeBytes: 4321 });
      expect(replaced).toBeNull();

      const read = await repo.findById(event.id);
      expect(read?.flyer.status).toBe('ready');
      expect(read?.flyer.sizeBytes).toBe(4321);
    });

    it('returns the displaced key when a ready flyer is replaced', async () => {
      const event = await makeEvent({ title: 'Replaced flyer' });
      await repo.setFlyerPending(event.id, flyer);
      await repo.setFlyerReady(event.id);

      const second = { ...flyer, key: 'events/one/def-new.png', name: 'new.png' };
      await repo.setFlyerPending(event.id, second);
      const replaced = await repo.setFlyerReady(event.id);

      expect(replaced).toBe(flyer.key);

      const read = await repo.findById(event.id);
      expect(read?.flyer.key).toBe(second.key);
      expect(read?.flyer.status).toBe('ready');
    });

    it('clears the flyer back to none and hands back the key it held', async () => {
      const event = await makeEvent({ title: 'Cleared flyer' });
      await repo.setFlyerPending(event.id, flyer);
      await repo.setFlyerReady(event.id);

      const removed = await repo.clearFlyer(event.id);
      expect(removed).toBe(flyer.key);

      const read = await repo.findById(event.id);
      expect(read?.flyer).toEqual({ status: 'none', key: null, type: null, sizeBytes: null, name: null });
    });

    it('rolls a failed pending upload back, returning the key to delete', async () => {
      const event = await makeEvent({ title: 'Rolled back' });
      await repo.setFlyerPending(event.id, flyer);

      expect(await repo.clearFlyer(event.id)).toBe(flyer.key);
      expect((await repo.findById(event.id))?.flyer.status).toBe('none');
    });

    it('returns null for an event that does not exist', async () => {
      expect(await repo.setFlyerReady(crypto.randomUUID())).toBeNull();
      expect(await repo.clearFlyer(crypto.randomUUID())).toBeNull();
    });
  });

  // ===========================================================================
  // Pagination
  // ===========================================================================

  describe('pagination', () => {
    it('honours limit and offset while countVisible reports the full total', async () => {
      for (let i = 0; i < 5; i++) {
        await makeEvent({
          title: `Paged ${i}`,
          startsAt: new Date(NOW.getTime() + (i + 1) * DAY),
          audience: Entities.Config.EventAudience.PUBLIC,
        });
      }

      const page = await repo.listVisible({ viewerUserId: null, now: NOW, limit: 2, offset: 2 });
      expect(page.map(e => e.title)).toEqual(['Paged 2', 'Paged 3']);
      expect(await repo.countVisible({ viewerUserId: null, now: NOW })).toBe(5);
    });
  });
});
