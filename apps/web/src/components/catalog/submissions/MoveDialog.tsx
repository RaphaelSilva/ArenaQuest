'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { SubmissionsApiError, type MoveSubmissionsResult, type Submission } from '@web/lib/submissions-api';
import type { TopicNode } from '@web/lib/topics-api';
import { SubmissionModal } from './SubmissionModal';
import { submissionErrorMessage } from './submission-errors';

/** What the dialog needs of each submission being moved. */
export type MovableSubmission = Pick<Submission, 'id' | 'title' | 'topicNodeId'>;

/** One readable target, in tree order, with its depth for the indent. */
export type MoveTarget = { id: string; title: string; depth: number };

/** Free slots per target: a number once the summary answered, `loading` before, `unknown` on a failure. */
type Slots = number | 'loading' | 'unknown';

/** How many summaries are fetched at once while the picker fills in its free slots. */
const SLOT_CONCURRENCY = 4;

/**
 * The catalog topics in tree order (siblings by `order`), each with its depth,
 * minus `excluded`. A topic whose parent the caller cannot read is a root, so
 * nothing readable is ever dropped.
 */
export function moveTargets(topics: readonly TopicNode[], excluded: ReadonlySet<string>): MoveTarget[] {
  const readable = topics.filter((topic) => !topic.archived);
  const ids = new Set(readable.map((topic) => topic.id));
  const children = new Map<string | null, TopicNode[]>();
  for (const topic of readable) {
    const parent = topic.parentId && ids.has(topic.parentId) ? topic.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(topic);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const out: MoveTarget[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const topic of children.get(parent) ?? []) {
      if (visited.has(topic.id)) continue;
      visited.add(topic.id);
      if (!excluded.has(topic.id)) out.push({ id: topic.id, title: topic.title, depth });
      walk(topic.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

type MoveDialogProps = {
  /** 1..10 ready submissions; their topics are never offered as a target. */
  submissions: MovableSubmission[];
  /** Called once the API answered with at least one moved item, so the caller refreshes its list and counts. */
  onMoved: (result: MoveSubmissionsResult) => void;
  onClose: () => void;
};

/**
 * Moves one or several submissions to another topic. The picker lists the
 * topics the caller can read (the catalog listing), each marked with its free
 * slots from the summary endpoint; the dialog states that moved submissions
 * become private. Partial success is a normal outcome: the report says what
 * moved and why each refusal happened.
 */
export function MoveDialog({ submissions, onMoved, onClose }: MoveDialogProps) {
  const dict = useDict();
  const t = dict.submissions.move;
  const client = useApiClient();
  const ids = { filter: useId(), picker: useId() };

  // Keyed on the topic ids, so a parent re-render with a new array does not refetch.
  const excludedKey = [...new Set(submissions.map((s) => s.topicNodeId))].sort().join('\n');
  const excluded = useMemo(() => new Set(excludedKey.split('\n')), [excludedKey]);
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);
  const [slots, setSlots] = useState<Record<string, Slots>>({});
  const [filter, setFilter] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: MoveSubmissionsResult; topic: string } | null>(null);

  useEffect(() => {
    let active = true;
    client.topics.list().then(
      (topics) => {
        if (!active) return;
        const list = moveTargets(topics, excluded);
        setTargets(list);
        setSlots(Object.fromEntries(list.map((target) => [target.id, 'loading' as const])));

        // Fill in each target's free slots, a few summaries at a time.
        let next = 0;
        const worker = async () => {
          while (active && next < list.length) {
            const target = list[next++];
            try {
              const summary = await client.submissions.summary(target.id);
              if (!active) return;
              const free = Math.max(0, summary.limits.perTopicMax - summary.usage.topicCount);
              setSlots((prev) => ({ ...prev, [target.id]: free }));
            } catch (err) {
              if (!active) return;
              if (err instanceof SubmissionsApiError && err.code === 'NotFound') {
                // The summary shares the catalog gate: a 404 means the topic is not readable.
                setTargets((prev) => prev?.filter((item) => item.id !== target.id) ?? prev);
              } else {
                setSlots((prev) => ({ ...prev, [target.id]: 'unknown' }));
              }
            }
          }
        };
        for (let i = 0; i < Math.min(SLOT_CONCURRENCY, list.length); i++) void worker();
      },
      () => {
        if (active) setTopicsFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [client, excluded]);

  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!targets) return [];
    return query ? targets.filter((target) => target.title.toLocaleLowerCase().includes(query)) : targets;
  }, [filter, targets]);

  const count = submissions.length;
  const selected = targets?.find((target) => target.id === targetId) ?? null;
  const selectedSlots = selected ? slots[selected.id] : undefined;

  const submit = async () => {
    if (!selected) {
      setError(t.chooseTarget);
      return;
    }
    setMoving(true);
    setError(null);
    try {
      const data = await client.submissions.move(
        submissions.map((s) => s.id),
        selected.id,
      );
      setResult({ data, topic: selected.title });
      if (data.moved.length > 0) onMoved(data);
    } catch (err) {
      if (err instanceof SubmissionsApiError && err.code === 'NotFound') {
        setTargets((prev) => prev?.filter((item) => item.id !== selected.id) ?? prev);
        setTargetId(null);
        setError(t.targetNotFound);
      } else {
        setError(submissionErrorMessage(dict, err));
      }
    } finally {
      setMoving(false);
    }
  };

  const titleOf = (id: string) => submissions.find((s) => s.id === id)?.title ?? id;
  const slotLabel = (value: Slots | undefined) =>
    value === 'loading' || value === undefined ? t.slotsLoading : value === 'unknown' ? t.slotsUnknown : t.freeSlots(value);

  if (result) {
    const { moved, refused } = result.data;
    return (
      <SubmissionModal label={t.heading(count)} onClose={onClose}>
        <div role="status">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--aq-text)' }}>
            {moved.length > 0 ? t.resultMoved(moved.length, result.topic) : t.resultNoneMoved}
          </p>
          {moved.length > 0 && (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
              {t.privateWarning}
            </p>
          )}
          {refused.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
                {t.refusedHeading(refused.length)}
              </p>
              <ul className="mt-1 list-disc pl-5 text-[13px]" style={{ color: 'var(--aq-text2)' }}>
                {refused.map((item) => (
                  <li key={item.id}>{t.refusedItem(titleOf(item.id), t.reasons[item.reason])}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[8px] px-4 py-2 text-[13px] font-bold"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {t.done}
          </button>
        </div>
      </SubmissionModal>
    );
  }

  return (
    <SubmissionModal label={t.heading(count)} onClose={onClose}>
      <p
        role="note"
        className="mb-3 rounded-[8px] border px-3 py-2 text-[12px] font-semibold"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text2)' }}
      >
        {t.privateWarning}
      </p>

      {topicsFailed ? (
        <p role="alert" className="text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {t.topicsError}
        </p>
      ) : targets === null ? (
        <p role="status" className="text-[13px]" style={{ color: 'var(--aq-text3)' }}>
          {t.loadingTopics}
        </p>
      ) : targets.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--aq-text2)' }}>
          {t.noTopics}
        </p>
      ) : (
        <>
          <label htmlFor={ids.filter} className="mb-1 block text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
            {t.filterLabel}
          </label>
          <input
            id={ids.filter}
            type="search"
            value={filter}
            placeholder={t.filterPlaceholder}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-3 w-full rounded-[8px] border px-3 py-2 text-[14px]"
            style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' }}
          />
          <fieldset>
            <legend id={ids.picker} className="mb-1 text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
              {t.pickerLabel}
            </legend>
            {visible.length === 0 ? (
              <p className="py-3 text-[13px]" style={{ color: 'var(--aq-text3)' }}>
                {t.noMatch}
              </p>
            ) : (
              <ul
                className="max-h-[40dvh] overflow-y-auto rounded-[8px] border"
                style={{ borderColor: 'var(--aq-border)' }}
              >
                {visible.map((target) => {
                  const value = slots[target.id];
                  const full = value === 0;
                  return (
                    <li key={target.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--aq-border)' }}>
                      <label
                        className={`flex items-center gap-2 px-3 py-2 text-[13px] ${full ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                        style={{ paddingLeft: `calc(0.75rem + ${target.depth} * 1rem)`, color: 'var(--aq-text)' }}
                      >
                        <input
                          type="radio"
                          name={ids.picker}
                          value={target.id}
                          checked={targetId === target.id}
                          disabled={full || moving}
                          onChange={() => {
                            setTargetId(target.id);
                            setError(null);
                          }}
                        />
                        <span className="min-w-0 flex-1 break-words">{target.title}</span>
                        <span className="flex-shrink-0 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
                          {slotLabel(value)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          {typeof selectedSlots === 'number' && selectedSlots > 0 && selectedSlots < count && (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
              {t.fewerSlots(selectedSlots, count)}
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={moving}
          className="cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
        >
          {t.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={moving || !targets || targets.length === 0}
          aria-busy={moving}
          className="cursor-pointer rounded-[8px] px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
        >
          {moving ? t.moving : t.submit}
        </button>
      </div>
    </SubmissionModal>
  );
}
