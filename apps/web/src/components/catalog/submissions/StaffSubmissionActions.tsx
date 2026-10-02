'use client';

import { useState } from 'react';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { useCurrentUser, useHasRole } from '@web/hooks/use-auth';
import type { StaffSubmissionView } from '@web/lib/submissions-api';
import { submissionErrorMessage } from './submission-errors';

export type StaffSubmissionAction = 'unshare' | 'allow' | 'remove';

type ActionTarget = Pick<StaffSubmissionView, 'status' | 'visibility' | 'moderated'>;

/**
 * The actions staff get on a student's submission: *Remove sharing* on a
 * shared one, *Allow sharing again* on a moderated one and — for `admin`
 * only — *Remove* on any ready one. A removed submission offers nothing.
 * Never an edit or a move: staff do not change a student's work.
 */
export function staffActionsFor(submission: ActionTarget, isAdmin: boolean): StaffSubmissionAction[] {
  if (submission.status !== 'ready') return [];
  const actions: StaffSubmissionAction[] = [];
  if (submission.moderated) actions.push('allow');
  else if (submission.visibility === 'shared') actions.push('unshare');
  if (isAdmin) actions.push('remove');
  return actions;
}

/** The API's `YYYY-MM-DD HH:MM:SS` shape for "now", in UTC, for the in-place tombstone. */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

type StaffSubmissionActionsProps = {
  submission: StaffSubmissionView;
  /** Applies the result to the card in place (no refetch). */
  onChange: (patch: Partial<StaffSubmissionView>) => void;
};

/**
 * The staff controls under a submission card, each behind an inline
 * confirmation. The UI only hides what a role may not do; the API enforces it.
 */
export function StaffSubmissionActions({ submission, onChange }: StaffSubmissionActionsProps) {
  const dict = useDict();
  const t = dict.submissions.staff;
  const client = useApiClient();
  const isAdmin = useHasRole(ROLES.ADMIN);
  const user = useCurrentUser();
  const [confirming, setConfirming] = useState<StaffSubmissionAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = staffActionsFor(submission, isAdmin);
  if (actions.length === 0) return null;

  const run = async (action: StaffSubmissionAction) => {
    setPending(true);
    setError(null);
    try {
      if (action === 'unshare') {
        onChange(await client.submissions.unshare(submission.id));
      } else if (action === 'allow') {
        await client.submissions.clearModeration(submission.id);
        onChange({ moderated: false, moderatedAt: null, moderatedBy: null });
      } else {
        await client.submissions.removeByStaff(submission.id);
        onChange({
          status: 'removed',
          removedAt: nowStamp(),
          removedBy: user?.id ?? null,
          removedByName: user?.name ?? null,
          visibility: 'private',
          sharedAt: null,
          description: '',
          url: null,
        });
      }
      setConfirming(null);
    } catch (err) {
      setError(
        action === 'unshare'
          ? t.unshareError
          : action === 'allow'
            ? t.allowSharingError
            : submissionErrorMessage(dict, err),
      );
    } finally {
      setPending(false);
    }
  };

  const labels: Record<StaffSubmissionAction, string> = {
    unshare: t.unshare,
    allow: t.allowSharing,
    remove: t.remove,
  };
  const prompts: Record<StaffSubmissionAction, string> = {
    unshare: t.confirmUnshare,
    allow: t.confirmAllowSharing,
    remove: t.confirmRemove,
  };

  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      {confirming ? (
        <div role="group" className="flex flex-wrap items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
            {prompts[confirming]}
          </span>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void run(confirming)}
            className="cursor-pointer rounded-[8px] px-3 py-1 text-[12px] font-bold disabled:cursor-wait disabled:opacity-60"
            style={
              confirming === 'remove'
                ? { background: 'var(--aq-error)', color: 'var(--aq-bg)' }
                : { background: 'var(--aq-accent)', color: 'var(--aq-bg)' }
            }
          >
            {pending ? t.pending : confirming === 'remove' ? t.remove : t.confirm}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(null)}
            className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold disabled:cursor-wait disabled:opacity-60"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.cancel}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                setError(null);
                setConfirming(action);
              }}
              className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
              style={{
                borderColor: action === 'remove' ? 'var(--aq-error)' : 'var(--aq-border2)',
                background: 'var(--aq-bg3)',
                color: action === 'remove' ? 'var(--aq-error)' : 'var(--aq-text)',
              }}
            >
              {labels[action]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
