'use client';

import { useDict } from '@web/context/dict-context';
import type { AdminEventStatus } from '@web/lib/admin-events-api';

type PublishControlsProps = {
  status: AdminEventStatus;
  /** Whether the session holds the `admin` role the API requires to publish. */
  canPublish: boolean;
  pending: AdminEventStatus | null;
  error: string;
  onTransition: (status: AdminEventStatus) => void;
};

/**
 * The status transitions, mirroring the API's own gates honestly.
 *
 * Two rules are visible here rather than implied:
 *
 * - **Publishing is `admin`-only.** A `content_creator` gets a disabled control
 *   *with the reason printed beside it*, not an enabled button that answers
 *   `403`. The client hiding it is a courtesy; the API's `requireRole` is what
 *   makes it true, and this component does not re-derive that rule — it reads
 *   the session's roles and shows the API's refusal when one arrives anyway.
 * - **There is no delete control.** No `DELETE /{id}` exists; removal is
 *   `archived`, which is reversible. A delete button here could only 404.
 */
export function PublishControls({
  status,
  canPublish,
  pending,
  error,
  onTransition,
}: PublishControlsProps) {
  const dict = useDict();
  const d = dict.admin.events.publish;

  const stateNote =
    status === 'published' ? d.statePublished : status === 'archived' ? d.stateArchived : d.stateDraft;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
        {d.sectionTitle}
      </h2>
      <p className="text-sm" style={{ color: 'var(--text2)' }}>
        {stateNote}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {status !== 'published' && (
          <button
            type="button"
            onClick={() => onTransition('published')}
            disabled={!canPublish || pending !== null}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#0B0E17' }}
          >
            {pending === 'published' ? d.publishing : d.publishButton}
          </button>
        )}

        {status === 'published' && (
          <button
            type="button"
            onClick={() => onTransition('draft')}
            disabled={pending !== null}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
          >
            {d.unpublishButton}
          </button>
        )}

        {status !== 'archived' && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(d.archiveConfirm)) onTransition('archived');
            }}
            disabled={pending !== null}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
          >
            {pending === 'archived' ? d.archiving : d.archiveButton}
          </button>
        )}

        {status === 'archived' && (
          <button
            type="button"
            onClick={() => onTransition('draft')}
            disabled={pending !== null}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
          >
            {d.unpublishButton}
          </button>
        )}
      </div>

      {!canPublish && status !== 'published' && (
        <p className="text-xs" style={{ color: 'var(--text2)' }}>
          {d.adminOnly}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
