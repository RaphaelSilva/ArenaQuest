'use client';

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useDict } from '@web/context/dict-context';
import { formatBytes } from './submission-format';

type SubmissionDropZoneProps = {
  /** Id of the native input, so the form's `<label htmlFor>` keeps naming it. */
  inputId: string;
  accept: string;
  disabled: boolean;
  /** The file currently chosen, shown in place of the call to action. */
  file: File | null;
  /** Id of the type/size hint rendered below the zone. */
  describedBy?: string;
  /** One handler for both a pick and a drop; `null` when the picker was dismissed. */
  onSelect: (file: File | null) => void;
};

/**
 * Drop zone for the single file of a submission. The native input stays in the
 * DOM (visually hidden) so screen readers and mobile pickers keep working; the
 * zone opens it on click, Enter or Space, and a drop feeds the first file to the
 * same `onSelect` a pick does.
 */
export function SubmissionDropZone({ inputId, accept, disabled, file, describedBy, onSelect }: SubmissionDropZoneProps) {
  const dict = useDict();
  const t = dict.submissions.upload;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPicker();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    // Always prevent the default, so a file dropped while busy is not opened by the browser.
    event.preventDefault();
    if (disabled) return;
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onSelect(dropped);
  };

  const active = dragging && !disabled;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={t.dropzoneLabel}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      data-state={disabled ? 'disabled' : active ? 'active' : file ? 'chosen' : 'idle'}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-6 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
      style={{
        borderColor: active ? 'var(--aq-accent)' : 'var(--aq-border2)',
        background: active ? 'var(--aq-accent-glow)' : 'var(--aq-bg3)',
        outlineColor: 'var(--aq-accent)',
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          onSelect(event.target.files?.[0] ?? null);
          // Clear the input so picking the same file again still fires a change.
          event.target.value = '';
        }}
      />
      <span
        aria-hidden="true"
        className="mb-2 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
      </span>
      {active ? (
        <p className="text-[13px] font-semibold" style={{ color: 'var(--aq-accent)' }}>
          {t.dropzoneActive}
        </p>
      ) : file ? (
        <>
          <p className="max-w-full truncate text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
            {t.dropzoneChosen(file.name, formatBytes(dict, file.size))}
          </p>
          <p className="mt-1 text-[12px] font-semibold underline" style={{ color: 'var(--aq-accent)' }}>
            {t.dropzoneChange}
          </p>
        </>
      ) : (
        <p className="text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
          {t.dropzoneCta}
        </p>
      )}
    </div>
  );
}
