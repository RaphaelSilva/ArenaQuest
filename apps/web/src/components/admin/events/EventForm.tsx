'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { brand } from '@web/lib/brand';
import { formatEventWhen } from '@web/components/events/event-format';
import {
  AdminEventsApiError,
  type AdminEvent,
  type AdminEventAudience,
  type AdminEventAudienceGrants,
  type AdminEventStatus,
  type CreateEventInput,
  type UpdateEventInput,
} from '@web/lib/admin-events-api';
import { AudienceSelector } from './AudienceSelector';
import { FlyerSection } from './FlyerSection';
import { PublishControls } from './PublishControls';
import { SlugField } from './SlugField';
import { WhatsappFields } from './WhatsappFields';
import { DEFAULT_EVENT_TIMEZONE, instantToWallTime, wallTimeToInstant } from './event-datetime';
import { slugifyTitle } from './event-slug';

type EventFormProps = {
  /** `null` creates a draft; an event edits it. */
  event: AdminEvent | null;
  /** Whether the session holds `admin` — the role the API's publish gate wants. */
  canPublish: boolean;
  /** Called with the freshly created draft, so the page can route to its editor. */
  onCreated: (event: AdminEvent) => void;
  /** Re-reads the event after a flyer or status change. */
  onReload: () => void;
};

const EMPTY_GRANTS: AdminEventAudienceGrants = { groupIds: [], userIds: [] };

/**
 * The audience call failed after the event itself was written.
 *
 * Carried as a type so the message can say exactly that, rather than "could not
 * save the event" about an event that *was* saved.
 */
class GrantsFailed extends Error {}

/**
 * Authoring one event.
 *
 * Three behaviours here are recorded decisions rather than conveniences:
 *
 * 1. **The slug is derived once.** `slugifyTitle` runs only while creating and
 *    only while the field is untouched. Renaming a saved event does not move
 *    it, and `update` is not even handed a `slug` unless the override was
 *    explicitly accepted.
 * 2. **The contact fields are pre-filled, then persisted.** The number starts
 *    from `brand.whatsapp` and the message from a dictionary template composed
 *    with this event's title and date. Both are then ordinary stored columns —
 *    the API composes nothing at read time, and neither does the public page.
 * 3. **A prefill never clobbers a human.** The message follows the title only
 *    while nobody has edited it. Once edited, a title change *warns* instead,
 *    because the stored text would otherwise keep advertising the old name.
 */
export function EventForm({ event, canPublish, onCreated, onReload }: EventFormProps) {
  const dict = useDict();
  const d = dict.admin.events;
  const client = useApiClient();
  const mode: 'create' | 'edit' = event === null ? 'create' : 'edit';

  // --- The basics ---------------------------------------------------------
  const [title, setTitle] = useState(event?.title ?? '');
  const [slug, setSlug] = useState(event?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [summary, setSummary] = useState(event?.summary ?? '');
  const [content, setContent] = useState(event?.content ?? '');
  const [location, setLocation] = useState(event?.location ?? '');

  // --- When ---------------------------------------------------------------
  const [timezone, setTimezone] = useState(event?.timezone ?? DEFAULT_EVENT_TIMEZONE);
  const [startsAt, setStartsAt] = useState(
    event ? instantToWallTime(event.startsAt, event.timezone) : '',
  );
  const [endsAt, setEndsAt] = useState(
    event?.endsAt ? instantToWallTime(event.endsAt, event.timezone) : '',
  );

  // --- Audience -----------------------------------------------------------
  const [audience, setAudience] = useState<AdminEventAudience>(event?.audience ?? 'restricted');
  const [grants, setGrants] = useState<AdminEventAudienceGrants>(
    event?.audienceGrants ?? EMPTY_GRANTS,
  );

  // --- Contact ------------------------------------------------------------
  const [whatsappNumber, setWhatsappNumber] = useState(event?.whatsappNumber ?? brand.whatsapp);
  const [whatsappMessage, setWhatsappMessage] = useState(event?.whatsappMessage ?? '');
  const [contactLabel, setContactLabel] = useState(event?.contactLabel ?? '');
  /**
   * An existing event's message is already a human's decision — including the
   * decision to leave it empty, which means "open the chat with nothing typed".
   * Auto-filling it on load would undo that silently, so edit mode starts
   * touched and offers the suggestion as a button instead.
   */
  const [messageTouched, setMessageTouched] = useState(mode === 'edit');
  const [messageTitle, setMessageTitle] = useState(event?.title ?? '');

  // --- Submission ---------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState('');
  const [transition, setTransition] = useState<AdminEventStatus | null>(null);
  const [transitionError, setTransitionError] = useState('');

  const startsAtIso = wallTimeToInstant(startsAt, timezone);
  const endsAtIso = endsAt ? wallTimeToInstant(endsAt, timezone) : null;

  /** The dictionary template, composed with this event's title and date. */
  const suggestedMessage = useMemo(() => {
    const when = startsAtIso
      ? formatEventWhen({ startsAt: startsAtIso, endsAt: null, timezone }, dict.events.locale).date
      : '';
    return d.contact.messageTemplate(title.trim(), when);
  }, [d, dict.events.locale, startsAtIso, timezone, title]);

  // The slug follows the title only while creating, and only until a human
  // types in the field. It is never re-derived afterwards.
  useEffect(() => {
    if (mode !== 'create' || slugTouched) return;
    setSlug(slugifyTitle(title));
  }, [mode, slugTouched, title]);

  // The message follows the suggestion only while untouched.
  useEffect(() => {
    if (messageTouched) return;
    setWhatsappMessage(suggestedMessage);
    setMessageTitle(title);
  }, [messageTouched, suggestedMessage, title]);

  const titleChanged =
    messageTouched && whatsappMessage.trim() !== '' && title.trim() !== messageTitle.trim();

  const handleMessageChange = (value: string) => {
    setMessageTouched(true);
    setMessageTitle(title);
    setWhatsappMessage(value);
  };

  const handleUseSuggestion = () => {
    setMessageTouched(true);
    setMessageTitle(title);
    setWhatsappMessage(suggestedMessage);
  };

  const validate = (): string => {
    if (title.trim() === '') return d.form.requiredTitle;
    if (startsAtIso === null) return d.form.requiredStartsAt;
    if (endsAt !== '' && (endsAtIso === null || endsAtIso <= startsAtIso)) return d.form.invalidRange;
    return '';
  };

  const commonPayload = (): CreateEventInput => ({
    title: title.trim(),
    summary: summary.trim(),
    content,
    location: location.trim(),
    // `startsAtIso` is non-null past `validate`.
    startsAt: startsAtIso as string,
    endsAt: endsAtIso,
    timezone: timezone.trim() || DEFAULT_EVENT_TIMEZONE,
    audience,
    whatsappNumber: whatsappNumber.trim(),
    whatsappMessage,
    contactLabel: contactLabel.trim(),
  });

  const describeError = (error: unknown): string => {
    if (error instanceof GrantsFailed) return d.audience.errorSavingGrants;
    if (error instanceof AdminEventsApiError && error.code === 'SlugConflict') {
      return d.form.errorSlugConflict;
    }
    return d.form.errorSaving;
  };

  /**
   * Replace the grant set, but only where it means anything.
   *
   * A separate call and a separate error: the event itself is already saved by
   * the time this runs, so a failure here must not read as "nothing was saved".
   */
  const saveGrants = async (id: string) => {
    if (audience !== 'restricted') return;
    try {
      await client.adminEvents.replaceAudience(id, grants);
    } catch {
      throw new GrantsFailed();
    }
  };

  const handleSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const invalid = validate();
    if (invalid) {
      setFormError(invalid);
      return;
    }

    setSaving(true);
    setSaved(false);
    setFormError('');

    try {
      if (event === null) {
        const payload: CreateEventInput = { ...commonPayload() };
        // On creation the slug is named explicitly, so what the form showed is
        // what the event gets. After that it is never sent again unless the
        // override was accepted.
        if (slug.trim() !== '') payload.slug = slug.trim();
        const created = await client.adminEvents.create(payload);
        await saveGrants(created.id);
        onCreated(created);
        return;
      }

      const payload: UpdateEventInput = { ...commonPayload() };
      if (slugUnlocked && slug.trim() !== '' && slug.trim() !== event.slug) {
        payload.slug = slug.trim();
      }
      await client.adminEvents.update(event.id, payload);
      await saveGrants(event.id);
      setSaved(true);
      onReload();
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (next: AdminEventStatus) => {
    if (!event) return;
    setTransition(next);
    setTransitionError('');
    try {
      await client.adminEvents.update(event.id, { status: next });
      onReload();
    } catch (error) {
      // The client hides the publish control from a non-admin, but the API's
      // 403 is what makes the rule true — so it is surfaced, not swallowed.
      setTransitionError(
        error instanceof AdminEventsApiError && error.status === 403
          ? d.publish.forbidden
          : d.publish.errorTransition,
      );
    } finally {
      setTransition(null);
    }
  };

  const fieldStyle = {
    borderColor: 'var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.form.basicsSection}
        </h2>

        <div>
          <label htmlFor="event-title" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
            {d.form.titleLabel}
          </label>
          <input
            id="event-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={d.form.titlePlaceholder}
            maxLength={200}
            required
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={fieldStyle}
          />
        </div>

        <SlugField
          slug={slug}
          onSlugChange={(value) => {
            setSlugTouched(true);
            setSlug(value);
          }}
          mode={mode}
          unlocked={slugUnlocked}
          onUnlock={() => setSlugUnlocked(true)}
        />

        <div>
          <label htmlFor="event-summary" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
            {d.form.summaryLabel}
          </label>
          <input
            id="event-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={500}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={fieldStyle}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
            {d.form.summaryHint}
          </p>
        </div>

        <div>
          <label htmlFor="event-location" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
            {d.form.locationLabel}
          </label>
          <input
            id="event-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={d.form.locationPlaceholder}
            maxLength={200}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={fieldStyle}
          />
        </div>

        <div>
          <label htmlFor="event-content" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
            {d.form.contentLabel}
          </label>
          <textarea
            id="event-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none"
            style={fieldStyle}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
            {d.form.contentHint}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
          {d.form.whenSection}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="event-starts-at" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
              {d.form.startsAtLabel}
            </label>
            <input
              id="event-starts-at"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="event-ends-at" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
              {d.form.endsAtLabel}
            </label>
            <input
              id="event-ends-at"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={fieldStyle}
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
              {d.form.endsAtHint}
            </p>
          </div>
        </div>
        <div>
          <label htmlFor="event-timezone" className="mb-1 block text-xs" style={{ color: 'var(--text2)' }}>
            {d.form.timezoneLabel}
          </label>
          <input
            id="event-timezone"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            maxLength={64}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={fieldStyle}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--text3)' }}>
            {d.form.timezoneHint}
          </p>
        </div>
      </section>

      <AudienceSelector
        audience={audience}
        onAudienceChange={setAudience}
        grants={grants}
        onGrantsChange={setGrants}
      />

      <WhatsappFields
        number={whatsappNumber}
        onNumberChange={setWhatsappNumber}
        message={whatsappMessage}
        onMessageChange={handleMessageChange}
        contactLabel={contactLabel}
        onContactLabelChange={setContactLabel}
        suggestedMessage={suggestedMessage}
        onUseSuggestion={handleUseSuggestion}
        titleChanged={titleChanged}
      />

      <FlyerSection
        eventId={event?.id ?? null}
        flyer={event?.flyer ?? null}
        onFlyerChanged={onReload}
      />

      {formError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: '#0B0E17' }}
        >
          {saving ? d.form.saving : mode === 'create' ? d.form.createButton : d.form.saveButton}
        </button>
        {saved && (
          <span role="status" className="text-sm" style={{ color: 'var(--text2)' }}>
            {d.form.saved}
          </span>
        )}
      </div>

      {event !== null && (
        <PublishControls
          status={event.status}
          canPublish={canPublish}
          pending={transition}
          error={transitionError}
          onTransition={handleTransition}
        />
      )}
    </form>
  );
}
