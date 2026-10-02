'use client';

import { useId, useState, type FormEvent } from 'react';
import { SUBMISSION_DESCRIPTION_MAX, SUBMISSION_TITLE_MAX } from '@arenaquest/shared/domain/submissions/limits';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { EditSubmissionInput, Submission, SubmissionVisibility } from '@web/lib/submissions-api';
import { SubmissionModal } from './SubmissionModal';
import { SubmissionVisibilitySwitch } from './SubmissionVisibilitySwitch';
import { submissionErrorMessage } from './submission-errors';

type EditSubmissionDialogProps = {
  topicId: string;
  submission: Submission;
  sharingEnabled: boolean;
  onSaved: (submission: Submission) => void;
  onClose: () => void;
};

const fieldStyle = { borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)', color: 'var(--aq-text)' };

/**
 * Edits title, description and visibility (last write wins). The switch is
 * absent while the label's sharing is off, and replaced by a note while the
 * staff keep the submission private.
 */
export function EditSubmissionDialog({ topicId, submission, sharingEnabled, onSaved, onClose }: EditSubmissionDialogProps) {
  const dict = useDict();
  const t = dict.submissions;
  const client = useApiClient();
  const ids = { title: useId(), description: useId(), counter: useId() };

  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description);
  const [visibility, setVisibility] = useState<SubmissionVisibility>(submission.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overLimit = description.length > SUBMISSION_DESCRIPTION_MAX;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t.preflight.titleRequired);
      return;
    }
    if (overLimit) {
      setError(t.preflight.descriptionTooLong(SUBMISSION_DESCRIPTION_MAX));
      return;
    }
    const input: EditSubmissionInput = { title: cleanTitle, description };
    // Never send a visibility the label cannot honour; the stored one stays as it is.
    if (sharingEnabled && visibility !== submission.visibility) input.visibility = visibility;

    setSaving(true);
    setError(null);
    try {
      const saved = await client.submissions.edit(topicId, submission.id, input);
      onSaved(saved);
    } catch (err) {
      setError(submissionErrorMessage(dict, err));
      setSaving(false);
    }
  };

  return (
    <SubmissionModal label={t.edit.heading} onClose={onClose}>
      <form onSubmit={save} noValidate>
        <label htmlFor={ids.title} className="mb-1 block text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
          {t.upload.titleLabel}
        </label>
        <input
          id={ids.title}
          type="text"
          value={title}
          maxLength={SUBMISSION_TITLE_MAX}
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-[8px] border px-3 py-2 text-[14px]"
          style={fieldStyle}
        />

        <label
          htmlFor={ids.description}
          className="mb-1 mt-4 block text-[13px] font-semibold"
          style={{ color: 'var(--aq-text)' }}
        >
          {t.upload.descriptionLabel}
        </label>
        <textarea
          id={ids.description}
          value={description}
          rows={4}
          disabled={saving}
          placeholder={t.upload.descriptionPlaceholder}
          aria-describedby={ids.counter}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-[8px] border px-3 py-2 text-[14px]"
          style={fieldStyle}
        />
        <p
          id={ids.counter}
          aria-label={t.upload.counterLabel(description.length, SUBMISSION_DESCRIPTION_MAX)}
          className="mt-1 text-right text-[12px]"
          style={{ color: overLimit ? 'var(--aq-error)' : 'var(--aq-text3)' }}
        >
          {t.upload.counter(description.length, SUBMISSION_DESCRIPTION_MAX)}
        </p>

        {sharingEnabled &&
          (submission.moderated ? (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--aq-text2)' }}>
              {t.edit.moderated}
            </p>
          ) : (
            <div className="mt-3">
              <SubmissionVisibilitySwitch visibility={visibility} disabled={saving} onChange={setVisibility} />
            </div>
          ))}

        {error && (
          <p role="alert" className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--aq-error)' }}>
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="cursor-pointer rounded-[8px] border px-4 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
          >
            {t.edit.cancel}
          </button>
          <button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="cursor-pointer rounded-[8px] px-4 py-2 text-[13px] font-bold disabled:cursor-wait disabled:opacity-60"
            style={{ background: 'var(--aq-accent)', color: 'var(--aq-bg)' }}
          >
            {saving ? t.edit.saving : t.edit.save}
          </button>
        </div>
      </form>
    </SubmissionModal>
  );
}
