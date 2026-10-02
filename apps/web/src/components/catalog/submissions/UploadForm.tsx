'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { SUBMISSION_DESCRIPTION_MAX, SUBMISSION_TITLE_MAX } from '@arenaquest/shared/domain/submissions/limits';
import { mediaSizeLimitFor } from '@arenaquest/shared/domain/media/limits';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import {
  SubmissionsApiError,
  uploadToPresignedUrl,
  type SubmissionSummary,
  type SubmissionVisibility,
} from '@web/lib/submissions-api';
import { SubmissionDropZone } from './SubmissionDropZone';
import { SubmissionVisibilitySwitch } from './SubmissionVisibilitySwitch';
import { submissionErrorMessage } from './submission-errors';
import { SUBMISSION_ACCEPT, formatBytes, preflightSubmission, titleFromFileName } from './submission-format';

type Phase = 'editing' | 'uploading' | 'finalizing' | 'cancelling';

export type UploadOutcome = 'uploaded' | 'cancelled' | 'failed';

type UploadFormProps = {
  topicId: string;
  summary: SubmissionSummary;
  /** The pending submission currently being uploaded, so the list does not show it as interrupted. */
  onActiveUploadChange?: (submissionId: string | null) => void;
  /** Called once the attempt ends; the caller refreshes the list and the summary. */
  onFinished: (outcome: UploadOutcome) => void;
  onClose: () => void;
  /** The PUT; injectable for tests. */
  upload?: typeof uploadToPresignedUrl;
};

const fieldStyle = { borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' };

/**
 * Upload form: file, title (prefilled from the file name), description and
 * visibility. The file is checked against the summary before any request; the
 * PUT runs over XHR with a progress bar and a Cancel that aborts it and then
 * deletes the pending row.
 */
export function UploadForm({
  topicId,
  summary,
  onActiveUploadChange,
  onFinished,
  onClose,
  upload = uploadToPresignedUrl,
}: UploadFormProps) {
  const dict = useDict();
  const t = dict.submissions.upload;
  const client = useApiClient();
  const ids = { file: useId(), fileHint: useId(), title: useId(), description: useId(), counter: useId() };

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<SubmissionVisibility>('private');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('editing');
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const busy = phase !== 'editing';
  const imageMax = mediaSizeLimitFor('image/jpeg');
  const pdfMax = mediaSizeLimitFor('application/pdf');

  /** The one path for a picked or a dropped file. */
  const onPick = (picked: File | null) => {
    if (busy) return;
    setFile(picked);
    setError(null);
    if (!picked) return;
    const check = preflightSubmission(dict, picked, summary);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (!titleEdited) setTitle(titleFromFileName(picked.name, SUBMISSION_TITLE_MAX));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError(dict.submissions.preflight.noFile);
      return;
    }
    const check = preflightSubmission(dict, file, summary);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(dict.submissions.preflight.titleRequired);
      return;
    }
    if (description.length > SUBMISSION_DESCRIPTION_MAX) {
      setError(dict.submissions.preflight.descriptionTooLong(SUBMISSION_DESCRIPTION_MAX));
      return;
    }

    setError(null);
    setProgress(0);
    setPhase('uploading');

    let submissionId: string | null = null;
    let stage: 'presign' | 'put' | 'finalize' = 'presign';
    try {
      const presigned = await client.submissions.presign(topicId, {
        fileName: file.name,
        contentType: check.contentType,
        sizeBytes: file.size,
        title: cleanTitle,
        ...(description.trim() ? { description } : {}),
        visibility,
      });
      submissionId = presigned.submission.id;
      onActiveUploadChange?.(submissionId);

      stage = 'put';
      const controller = new AbortController();
      abortRef.current = controller;
      await upload(presigned.uploadUrl, file, check.contentType, {
        signal: controller.signal,
        onProgress: (fraction) => setProgress(fraction),
      });
      abortRef.current = null;

      setPhase('finalizing');
      stage = 'finalize';
      await client.submissions.finalize(topicId, submissionId);
      onActiveUploadChange?.(null);
      onFinished('uploaded');
    } catch (err) {
      abortRef.current = null;
      if (err instanceof SubmissionsApiError && err.code === 'Aborted' && submissionId) {
        setPhase('cancelling');
        try {
          await client.submissions.remove(topicId, submissionId);
        } catch {
          // The pending row stays; the list shows it as interrupted with Discard.
        }
        onActiveUploadChange?.(null);
        onFinished('cancelled');
        return;
      }
      onActiveUploadChange?.(null);
      setPhase('editing');
      // A failed PUT leaves a pending row behind: say where it went.
      setError(stage === 'put' ? t.failed : submissionErrorMessage(dict, err));
      if (submissionId) onFinished('failed');
    }
  };

  const cancelUpload = () => {
    abortRef.current?.abort();
  };

  const percent = Math.round(progress * 100);
  const overLimit = description.length > SUBMISSION_DESCRIPTION_MAX;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t.heading}
      className="mb-6 rounded-[12px] border p-4"
      style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg2)' }}
    >
      <h3 className="mb-3 text-[15px] font-bold" style={{ color: 'var(--aq-text)' }}>
        {t.heading}
      </h3>

      <label htmlFor={ids.file} className="mb-1 block text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
        {t.fileLabel}
      </label>
      <SubmissionDropZone
        inputId={ids.file}
        accept={SUBMISSION_ACCEPT}
        disabled={busy}
        file={file}
        describedBy={ids.fileHint}
        onSelect={onPick}
      />
      <p id={ids.fileHint} className="mt-1 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
        {t.fileHint(
          formatBytes(dict, summary.limits.videoMaxBytes),
          imageMax === null ? '' : formatBytes(dict, imageMax),
          pdfMax === null ? '' : formatBytes(dict, pdfMax),
        )}
      </p>

      <label htmlFor={ids.title} className="mb-1 mt-4 block text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
        {t.titleLabel}
      </label>
      <input
        id={ids.title}
        type="text"
        value={title}
        maxLength={SUBMISSION_TITLE_MAX}
        disabled={busy}
        onChange={(e) => {
          setTitle(e.target.value);
          setTitleEdited(true);
        }}
        className="w-full rounded-[8px] border px-3 py-2 text-[14px]"
        style={fieldStyle}
      />

      <label
        htmlFor={ids.description}
        className="mb-1 mt-4 block text-[13px] font-semibold"
        style={{ color: 'var(--aq-text)' }}
      >
        {t.descriptionLabel}
      </label>
      <textarea
        id={ids.description}
        value={description}
        disabled={busy}
        rows={3}
        placeholder={t.descriptionPlaceholder}
        aria-describedby={ids.counter}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-[8px] border px-3 py-2 text-[14px]"
        style={fieldStyle}
      />
      <p
        id={ids.counter}
        aria-label={t.counterLabel(description.length, SUBMISSION_DESCRIPTION_MAX)}
        className="mt-1 text-right text-[12px]"
        style={{ color: overLimit ? 'var(--aq-error)' : 'var(--aq-text3)' }}
      >
        {t.counter(description.length, SUBMISSION_DESCRIPTION_MAX)}
      </p>

      {summary.sharingEnabled && (
        <div className="mt-3">
          <SubmissionVisibilitySwitch visibility={visibility} disabled={busy} onChange={setVisibility} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}

      {busy && (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-label={t.progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="overflow-hidden rounded-[10px]"
            style={{ height: 8, background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)' }}
          >
            <div
              className="h-full transition-all duration-150"
              style={{ width: `${percent}%`, background: 'var(--aq-accent)' }}
            />
          </div>
          <p aria-live="polite" className="mt-1.5 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
            {phase === 'uploading' && t.uploading(percent)}
            {phase === 'finalizing' && t.finalizing}
            {phase === 'cancelling' && t.cancelling}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {phase === 'uploading' ? (
          <button
            type="button"
            onClick={cancelUpload}
            className="cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold"
            style={{ borderColor: 'var(--aq-error)', color: 'var(--aq-error)' }}
          >
            {t.cancelUpload}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-[8px] px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
            >
              {t.submit}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
