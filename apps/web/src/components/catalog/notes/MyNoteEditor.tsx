'use client';

import { useId, useState } from 'react';
import { NOTE_BODY_MAX } from '@arenaquest/shared/domain/notes/limits';
import { useDict } from '@web/context/dict-context';
import { MarkdownViewer } from '../MarkdownViewer';
import { SectionError } from '../SectionError';
import { ConflictBanner } from './ConflictBanner';
import { ModerationBanner } from './ModerationBanner';
import { SaveStateIndicator } from './SaveStateIndicator';
import { VisibilitySwitch } from './VisibilitySwitch';
import { useNoteAutosave } from './useNoteAutosave';

type MyNoteEditorProps = {
  topicId: string;
  /** Autosave debounce override, for tests. */
  debounceMs?: number;
};

type Mode = 'write' | 'preview';

/** The caller's own note on a topic: Markdown editor, preview, autosave, sharing and delete. */
export function MyNoteEditor({ topicId, debounceMs }: MyNoteEditorProps) {
  const dict = useDict();
  const textareaId = useId();
  const counterId = useId();
  const note = useNoteAutosave(topicId, debounceMs);
  const [mode, setMode] = useState<Mode>('write');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState('');

  if (note.loadState === 'loading') {
    return (
      <div className="flex justify-center py-8" role="status" aria-label={dict.notes.loading}>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--aq-accent)] border-t-transparent" />
      </div>
    );
  }

  if (note.loadState === 'error') {
    return (
      <div className="flex flex-col items-center gap-3">
        <SectionError message={dict.notes.loadError} />
        <button
          type="button"
          onClick={note.reload}
          className="cursor-pointer rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
          style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
        >
          {dict.common.retry}
        </button>
      </div>
    );
  }

  const hasNote = note.revision > 0;
  const paused = note.conflict !== null;

  const modeButton = (value: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className="cursor-pointer rounded-[8px] px-3 py-1 text-[12px] font-semibold transition-colors duration-150"
      style={{
        background: mode === value ? 'var(--aq-bg4)' : 'transparent',
        color: mode === value ? 'var(--aq-text)' : 'var(--aq-text2)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="rounded-[14px] border p-4"
      style={{ borderColor: 'var(--aq-border)', background: 'var(--aq-bg2)' }}
    >
      <ConflictBanner
        conflict={note.conflict}
        notice={notice}
        onLoadLatest={() => {
          void note.loadLatest().then(() => setNotice(dict.notes.conflict.copied));
        }}
        onKeepMine={() => {
          setNotice('');
          void note.keepMine();
        }}
        onRecreate={() => {
          setNotice('');
          void note.recreate();
        }}
        onDiscard={() => {
          setNotice('');
          note.discard();
        }}
      />

      {note.moderated && <ModerationBanner />}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={dict.notes.modeLabel} className="flex gap-1">
          {modeButton('write', dict.notes.write)}
          {modeButton('preview', dict.notes.preview)}
        </div>
        <SaveStateIndicator state={note.saveState} />
      </div>

      <label htmlFor={textareaId} className="sr-only">
        {dict.notes.editorLabel}
      </label>
      {mode === 'write' ? (
        <textarea
          id={textareaId}
          value={note.text}
          onChange={(e) => {
            setNotice('');
            note.setText(e.target.value);
          }}
          placeholder={dict.notes.placeholder}
          aria-describedby={counterId}
          aria-invalid={note.overLimit}
          rows={8}
          className="w-full resize-y rounded-[10px] border p-3 text-[14px] outline-none transition-colors duration-150 placeholder-[var(--aq-text3)] focus:border-[var(--aq-accent)]"
          style={{
            borderColor: note.overLimit ? 'var(--aq-error)' : 'var(--aq-border2)',
            background: 'var(--aq-bg3)',
            color: 'var(--aq-text)',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <div
          className="min-h-[10rem] rounded-[10px] border p-3"
          style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg3)' }}
        >
          {note.text.trim() ? (
            <MarkdownViewer content={note.text} />
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--aq-text3)' }}>
              {dict.notes.previewEmpty}
            </p>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span
          id={counterId}
          aria-label={dict.notes.counterLabel(note.text.length, NOTE_BODY_MAX)}
          className="text-[12px] tabular-nums"
          style={{ color: note.overLimit ? 'var(--aq-error)' : 'var(--aq-text3)' }}
        >
          {dict.notes.counter(note.text.length, NOTE_BODY_MAX)}
        </span>
        {note.overLimit && (
          <span className="text-[12px] font-semibold" style={{ color: 'var(--aq-error)' }}>
            {dict.notes.overLimit(NOTE_BODY_MAX)}
          </span>
        )}
      </div>

      <VisibilitySwitch
        visibility={note.visibility}
        disabled={note.moderated || paused || !note.text.trim() || note.overLimit}
        onChange={(v) => void note.setVisibility(v)}
      />

      {hasNote && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--aq-border)' }}>
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px]" style={{ color: 'var(--aq-text)' }}>
                {dict.notes.delete.confirm}
              </span>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setNotice('');
                  void note.remove();
                }}
                className="cursor-pointer rounded-[8px] px-3 py-1 text-[12px] font-bold"
                style={{ background: 'var(--aq-error)', color: 'var(--aq-bg)' }}
              >
                {dict.notes.delete.confirmAction}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold"
                style={{ borderColor: 'var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                {dict.notes.delete.cancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={paused}
              className="cursor-pointer text-[12px] font-semibold transition-colors duration-150 hover:text-[var(--aq-error)] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: 'var(--aq-text3)' }}
            >
              {dict.notes.delete.action}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
