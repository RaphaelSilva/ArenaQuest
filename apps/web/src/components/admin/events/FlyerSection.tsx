'use client';

import { useState } from 'react';
import { useDict } from '@web/context/dict-context';
import { MediaUploader } from '@web/components/admin/MediaUploader';
import { useApiClient } from '@web/context/auth-context';
import type { AdminEventFlyer } from '@web/lib/admin-events-api';
import { useEventFlyerTarget } from './use-event-flyer-target';

type FlyerSectionProps = {
  /** `null` while the event is still being created — no id to presign against. */
  eventId: string | null;
  flyer: AdminEventFlyer | null;
  onFlyerChanged: () => void;
};

/**
 * The flyer slot: the shared uploader pointed at the event endpoints.
 *
 * The ceiling is stated **before** a file is picked, in `ceilingNotice`. A
 * designer's export routinely lands at 8 MB, and the worst moment to learn
 * about a 5 MB limit is after the upload failed.
 *
 * There is no delete control for the *event* anywhere in this surface; the
 * remove button here targets the flyer object, which is the one `DELETE` the
 * admin events router exposes.
 */
export function FlyerSection({ eventId, flyer, onFlyerChanged }: FlyerSectionProps) {
  const dict = useDict();
  const d = dict.admin.events.flyer;
  const client = useApiClient();
  const target = useEventFlyerTarget(eventId ?? '');

  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const handleRemove = async () => {
    if (!eventId) return;
    setRemoving(true);
    setRemoveError('');
    try {
      await client.adminEvents.deleteFlyer(eventId);
      onFlyerChanged();
    } catch {
      setRemoveError(d.removeFailed);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
        {d.sectionTitle}
      </h2>
      <p className="text-xs" style={{ color: 'var(--text2)' }}>
        {d.ceilingNotice}
      </p>

      {eventId === null ? (
        <p
          className="rounded-lg border border-dashed px-4 py-6 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}
        >
          {d.availableAfterCreate}
        </p>
      ) : (
        <>
          {flyer?.status === 'ready' && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}
            >
              <div className="min-w-0">
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  {d.currentLabel}
                </p>
                <p className="truncate text-sm" style={{ color: 'var(--text)' }}>
                  {flyer.name ?? flyer.key}
                </p>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  {flyer.sizeBytes === null
                    ? d.unknownSize
                    : `${Math.round((flyer.sizeBytes / (1024 * 1024)) * 10) / 10} MB`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
                style={{ borderColor: 'var(--border2)', color: 'var(--text2)' }}
              >
                {removing ? d.removing : d.removeButton}
              </button>
            </div>
          )}

          {flyer?.status === 'pending' && (
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              {d.pendingLabel}
            </p>
          )}

          {removeError && (
            <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
              {removeError}
            </p>
          )}

          <MediaUploader target={target} onUploadComplete={onFlyerChanged} />
        </>
      )}
    </section>
  );
}
