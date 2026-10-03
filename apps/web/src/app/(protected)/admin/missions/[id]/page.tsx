'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { Button } from '@web/components/design-system';
import { MissionForm } from '@web/components/missions/MissionForm';
import { RequirementEditor } from '@web/components/missions/RequirementEditor';
import {
  audienceChanged,
  draftFromDetail,
  emptyDraft,
  STEP_LIMITS,
  stepsChanged,
  toCreateInput,
  toPatchInput,
  validateMission,
  validateSteps,
  type MissionDraft,
  type MissionIssue,
} from '@web/components/missions/mission-draft';
import { mapMissionError, stepIssueMessage } from '@web/components/missions/mission-errors';
import { useTopicMediaStats } from '@web/components/missions/use-topic-media-stats';
import {
  cardClass,
  cardStyle,
  errorStyle,
  eyebrowClass,
  eyebrowStyle,
} from '@web/components/missions/form-styles';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type { Badge, MissionDetail } from '@web/lib/admin-gamification-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

export const runtime = 'edge';

/** One page of published events for the step picker. The API caps a page at 100. */
const EVENT_PAGE_SIZE = 100;

/**
 * The mission editor (`new` creates). Admins write; a content creator reads the
 * same page with every control disabled. Once `startAt` has passed (or the API
 * answers `409 MISSION_STARTED`) only the title, the description, extending the
 * end, the active switch and the step titles stay editable.
 */
export default function AdminMissionEditorPage() {
  const dict = useDict();
  const d = dict.admin.missions;
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const missionId = params.id;
  const isNew = missionId === 'new';
  const { isLoading: authLoading } = useAuth();
  const canAccess = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const canWrite = useHasRole(ROLES.ADMIN);
  const client = useApiClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [original, setOriginal] = useState<MissionDraft | null>(null);
  const [draft, setDraft] = useState<MissionDraft>(emptyDraft);
  const [startedByClock, setStartedByClock] = useState(false);
  const [startedByServer, setStartedByServer] = useState(false);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventPriced, setEventPriced] = useState<Record<string, boolean>>({});

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccess) router.replace('/dashboard');
    else if (isNew && !canWrite) router.replace('/admin/missions');
  }, [authLoading, canAccess, canWrite, isNew, router]);

  const applyDetail = useCallback((detail: MissionDetail) => {
    const next = draftFromDetail(detail);
    setOriginal(next);
    setDraft(next);
    // Read once per load: the lock follows the stored start, as the API's does.
    setStartedByClock(Date.now() >= Date.parse(detail.mission.startAt));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [detail, badgeList, topicList, eventList] = await Promise.all([
        isNew ? Promise.resolve(null) : client.adminGamification.missions.get(missionId),
        client.adminGamification.badges.list(),
        client.adminTopics.list(),
        client.adminEvents.list({ status: 'published', limit: EVENT_PAGE_SIZE }).then((page) => page.data),
      ]);
      if (detail) applyDetail(detail);
      setBadges(badgeList);
      setTopics(topicList);
      setEvents(eventList);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setLoadError(status === 404 ? d.notFound : d.loadError);
    } finally {
      setLoading(false);
    }
  }, [applyDetail, client, d, isNew, missionId]);

  useEffect(() => {
    if (!authLoading && canAccess && (canWrite || !isNew)) void load();
  }, [authLoading, canAccess, canWrite, isNew, load]);

  // Prices live behind the admin-only billing router: only an author needs them,
  // to disable the unpriced events. A failed read leaves the event selectable.
  useEffect(() => {
    if (!canWrite || events.length === 0) return;
    let cancelled = false;
    void Promise.all(
      events.map((event) =>
        client.adminBilling.extras
          .getPrice(event.id)
          .then((price) => [event.id, price !== null] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      for (const row of rows) if (row) map[row[0]] = row[1];
      setEventPriced(map);
    });
    return () => {
      cancelled = true;
    };
  }, [canWrite, client, events]);

  const mediaTopicIds = useMemo(
    () =>
      draft.steps
        .filter((s) => s.kind === 'topic_visited' || s.kind === 'video_watched')
        .map((s) => s.topicId),
    [draft.steps],
  );
  const mediaStats = useTopicMediaStats(mediaTopicIds);

  const readOnly = !canWrite;
  const started = !isNew && (startedByClock || startedByServer);

  const missionIssueMessage = (issue: MissionIssue): string => {
    switch (issue) {
      case 'title':
        return d.errors.titleRequired;
      case 'description':
        return d.errors.descriptionRequired;
      case 'window':
        return d.errors.windowRequired;
      case 'windowOrder':
        return d.errors.windowOrder;
      case 'xp':
        return d.errors.xpInvalid;
      case 'steps':
        return d.errors.stepsRequired;
    }
  };

  const updateDraft = (patch: Partial<MissionDraft>) => {
    setSaved(false);
    if ('steps' in patch) setStepErrors({});
    setDraft((current) => ({ ...current, ...patch }));
  };

  const videoCountOf = (topicId: string): number | undefined => {
    const stat = mediaStats[topicId];
    return stat?.status === 'ready' ? stat.videos : undefined;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setFormError('');
    setStepErrors({});
    setSaved(false);

    // A legacy predicate mission has no steps and cannot get any (`409 MISSION_LEGACY`).
    const legacy = !isNew && original !== null && original.steps.length === 0;
    const missionIssue = validateMission(draft, !legacy);
    if (missionIssue) {
      setFormError(missionIssueMessage(missionIssue));
      return;
    }

    // After start the steps cannot change, so only their titles are checked.
    const validation = started || (legacy && draft.steps.length === 0) ? null : validateSteps(draft.steps, videoCountOf);
    if (validation && !validation.ok) {
      const errors: Record<number, string> = {};
      for (const [index, issue] of Object.entries(validation.issues)) {
        errors[Number(index)] = stepIssueMessage(issue, d, STEP_LIMITS);
      }
      setStepErrors(errors);
      setFormError(d.errors.stepsInvalid);
      return;
    }
    if (started) {
      const untitled = draft.steps.findIndex((s) => !s.title.trim());
      if (untitled >= 0) {
        setStepErrors({ [untitled]: d.errors.stepTitleRequired });
        setFormError(d.errors.stepsInvalid);
        return;
      }
    }

    setSaving(true);
    const missions = client.adminGamification.missions;
    try {
      if (isNew) {
        const inputs = validation && validation.ok ? validation.inputs : [];
        await missions.create(toCreateInput(draft, inputs));
        router.push('/admin/missions');
        return;
      }
      if (!original) return;

      const patch = toPatchInput(draft, original, started);
      if (Object.keys(patch).length > 0) await missions.update(missionId, patch);

      if (started) {
        for (const step of draft.steps) {
          const before = original.steps.find((s) => s.key === step.key);
          if (step.id && before && before.title !== step.title.trim()) {
            await missions.updateRequirementTitle(missionId, step.id, step.title.trim());
          }
        }
      } else {
        if (validation && validation.ok && stepsChanged(draft.steps, original.steps)) {
          await missions.replaceRequirements(missionId, validation.inputs);
        }
        if (draft.enrollmentMode === 'assigned' && audienceChanged(draft.audience, original.audience)) {
          await missions.replaceAudience(missionId, draft.audience);
        }
      }

      applyDetail(await missions.get(missionId));
      setSaved(true);
    } catch (err) {
      const mapped = mapMissionError(err, d);
      setFormError(mapped.message);
      if (mapped.step) setStepErrors({ [mapped.step.index]: mapped.step.message });
      if (mapped.started) setStartedByServer(true);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (loading && !loadError)) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8 text-[color:var(--text3)]" />
      </div>
    );
  }
  if (!canAccess || (isNew && !canWrite)) return null;

  const heading = isNew ? d.createTitle : readOnly ? d.viewTitle : d.editTitle;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <Link href="/admin/missions" className="text-sm" style={{ color: 'var(--accent)' }}>
            {d.backToList}
          </Link>
          <h1
            className="mt-2 text-[28px] font-bold"
            style={{ color: 'var(--text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
          >
            {heading}
          </h1>
        </div>

        {loadError ? (
          <p role="alert" className="text-sm" style={errorStyle}>
            {loadError}
          </p>
        ) : (
          <form onSubmit={handleSave} noValidate className="space-y-6">
            {readOnly && (
              <p
                role="status"
                className="rounded-lg px-4 py-3 text-sm"
                style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
              >
                {d.readOnlyNotice}
              </p>
            )}
            {started && (
              <p
                role="status"
                data-testid="started-banner"
                className="rounded-lg px-4 py-3 text-sm"
                style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
              >
                {d.startedBanner}
              </p>
            )}

            <MissionForm
              draft={draft}
              onChange={updateDraft}
              badges={badges}
              readOnly={readOnly}
              started={started}
              isNew={isNew}
              originalEndAt={original?.endAt ?? ''}
            />

            <section className={`${cardClass} space-y-4`} style={cardStyle}>
              <h2 className={eyebrowClass} style={eyebrowStyle}>
                {d.sections.requirements}
              </h2>
              <RequirementEditor
                steps={draft.steps}
                onChange={(steps) => updateDraft({ steps })}
                mode={draft.mode}
                structureLocked={readOnly || started}
                titleLocked={readOnly}
                errors={stepErrors}
                topics={topics}
                events={events}
                eventPriced={eventPriced}
                mediaStats={mediaStats}
              />
            </section>

            {formError && (
              <p role="alert" className="text-sm" style={errorStyle}>
                {formError}
              </p>
            )}
            {saved && (
              <p role="status" className="text-sm" style={{ color: 'var(--accent3)' }}>
                {d.savedMessage}
              </p>
            )}

            {!readOnly && (
              <div className="flex justify-end gap-3">
                <Button type="button" variant="secondary" size="md" onClick={() => router.push('/admin/missions')}>
                  {d.cancelButton}
                </Button>
                <Button type="submit" variant="primary" size="md" disabled={saving} isLoading={saving}>
                  {saving ? d.savingButton : d.saveButton}
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
