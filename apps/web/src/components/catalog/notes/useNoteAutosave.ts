'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTE_BODY_MAX } from '@arenaquest/shared/domain/notes/limits';
import { useApiClient } from '@web/context/auth-context';
import type { Note, NoteVisibility, SaveNoteResult } from '@web/lib/notes-api';

/** Quiet period after the last keystroke before the note is saved (RFC 0016 section 4). */
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 2000;

export type NoteLoadState = 'loading' | 'ready' | 'error';

/**
 * What the save-state indicator shows. `conflict`, `error` and `overLimit` all
 * read as "not saved"; they are kept apart so the editor can explain why.
 */
export type NoteSaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error' | 'overLimit';

/** Set while autosave is paused on a `409 NOTE_STALE`; `current` is the stored note or null. */
export type NoteConflict = { current: Note | null };

type SaveOptions = { visibility?: NoteVisibility; baseRevision?: number };

export type UseNoteAutosave = {
  loadState: NoteLoadState;
  text: string;
  /** The revision this tab last received; `0` when there is no note. */
  revision: number;
  visibility: NoteVisibility;
  moderated: boolean;
  saveState: NoteSaveState;
  conflict: NoteConflict | null;
  /** True when the local text exceeds `NOTE_BODY_MAX`. */
  overLimit: boolean;
  reload: () => void;
  setText: (value: string) => void;
  setVisibility: (visibility: NoteVisibility) => Promise<void>;
  /** Conflict: take the stored note, putting the unsaved text on the clipboard. */
  loadLatest: () => Promise<void>;
  /** Conflict: re-send the local text over the stored revision. The only overwrite path. */
  keepMine: () => Promise<void>;
  /** Deleted elsewhere: create the note again from the local text. */
  recreate: () => Promise<void>;
  /** Deleted elsewhere: drop the local text and return to the empty state. */
  discard: () => void;
  remove: () => Promise<void>;
};

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // Clipboard denied: the text is still gone from the editor, but nothing
    // more can be done without a user gesture the browser accepts.
  }
}

/**
 * Loads the caller's note on a topic and keeps it saved: debounced autosave with
 * the held revision, and a hard stop on a revision conflict until the student
 * chooses how to resolve it. Nothing is ever overwritten silently.
 */
export function useNoteAutosave(
  topicId: string,
  debounceMs: number = NOTE_AUTOSAVE_DEBOUNCE_MS,
): UseNoteAutosave {
  const client = useApiClient();

  const [loadState, setLoadState] = useState<NoteLoadState>('loading');
  const [text, setTextState] = useState('');
  const [revision, setRevision] = useState(0);
  const [visibility, setVisibilityState] = useState<NoteVisibility>('private');
  const [moderated, setModerated] = useState(false);
  const [saveState, setSaveState] = useState<NoteSaveState>('idle');
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Refs mirror the state the async save path reads, so a save always sends
  // the latest text and the revision of the last response, never a stale closure.
  const textRef = useRef('');
  const revisionRef = useRef(0);
  const savedBodyRef = useRef('');
  const pausedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyNote = useCallback((note: Note | null) => {
    const body = note?.body ?? '';
    textRef.current = body;
    savedBodyRef.current = body;
    revisionRef.current = note?.revision ?? 0;
    setTextState(body);
    setRevision(note?.revision ?? 0);
    setVisibilityState(note?.visibility ?? 'private');
    setModerated(note?.moderated ?? false);
  }, []);

  const pause = useCallback((next: NoteConflict) => {
    pausedRef.current = true;
    clearTimer();
    setConflict(next);
    setSaveState('conflict');
    if (next.current?.moderated) setModerated(true);
  }, [clearTimer]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setConflict(null);
  }, []);

  const handleResult = useCallback((result: SaveNoteResult, sentBody: string) => {
    switch (result.kind) {
      case 'saved': {
        revisionRef.current = result.note.revision;
        savedBodyRef.current = sentBody;
        setRevision(result.note.revision);
        setVisibilityState(result.note.visibility);
        setModerated(result.note.moderated);
        setSaveState('saved');
        return true;
      }
      case 'stale':
        pause({ current: result.current });
        return false;
      case 'moderated':
        setModerated(true);
        setVisibilityState('private');
        setSaveState('error');
        return false;
      case 'invalid':
        setSaveState(result.code === 'NOTE_BODY_TOO_LONG' ? 'overLimit' : 'error');
        return false;
    }
  }, [pause]);

  const save = useCallback(async (options: SaveOptions = {}, force = false): Promise<boolean> => {
    const body = textRef.current;
    if (!body.trim()) return false; // An empty body never saves; deleting is explicit.
    if (body.length > NOTE_BODY_MAX) {
      setSaveState('overLimit');
      return false;
    }
    if (!force && options.visibility === undefined && body === savedBodyRef.current && revisionRef.current > 0) {
      return true; // Nothing new to send.
    }
    if (inFlightRef.current) {
      pendingRef.current = true;
      return false;
    }

    inFlightRef.current = true;
    setSaveState('saving');
    let ok = false;
    try {
      const result = await client.notes.saveMine(topicId, {
        body,
        ...(options.visibility !== undefined ? { visibility: options.visibility } : {}),
        baseRevision: options.baseRevision ?? revisionRef.current,
      });
      if (mountedRef.current) ok = handleResult(result, body);
    } catch {
      if (mountedRef.current) setSaveState('error');
    } finally {
      inFlightRef.current = false;
    }

    // The student kept typing while the request was out: send the newer text
    // on the revision just received, unless a conflict paused autosave.
    if (pendingRef.current && mountedRef.current) {
      pendingRef.current = false;
      if (!pausedRef.current && textRef.current !== savedBodyRef.current) {
        return save();
      }
    }
    return ok;
  }, [client, topicId, handleResult]);

  // Initial load, and reload on demand.
  useEffect(() => {
    let active = true;
    setLoadState('loading');
    pausedRef.current = false;
    setConflict(null);
    setSaveState('idle');

    client.notes.getMine(topicId)
      .then((note) => {
        if (!active) return;
        applyNote(note);
        setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [client, topicId, reloadKey, applyNote]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const setText = useCallback((value: string) => {
    textRef.current = value;
    setTextState(value);
    clearTimer();
    if (pausedRef.current) return; // Paused on a conflict: nothing is sent until the student chooses.
    if (value.length > NOTE_BODY_MAX) {
      setSaveState('overLimit');
      return;
    }
    if (!value.trim()) {
      setSaveState('idle');
      return;
    }
    setSaveState((s) => (s === 'overLimit' || s === 'error' ? 'idle' : s));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save();
    }, debounceMs);
  }, [clearTimer, debounceMs, save]);

  const setVisibility = useCallback(async (next: NoteVisibility) => {
    if (pausedRef.current) return;
    clearTimer();
    await save({ visibility: next }, true);
  }, [clearTimer, save]);

  const loadLatest = useCallback(async () => {
    if (!conflict?.current) return;
    const unsaved = textRef.current;
    await copyToClipboard(unsaved);
    applyNote(conflict.current);
    resume();
    setSaveState('saved');
  }, [conflict, applyNote, resume]);

  const keepMine = useCallback(async () => {
    if (!conflict?.current) return;
    const base = conflict.current.revision;
    resume();
    await save({ baseRevision: base }, true);
  }, [conflict, resume, save]);

  const recreate = useCallback(async () => {
    if (!conflict || conflict.current !== null) return;
    resume();
    revisionRef.current = 0;
    setRevision(0);
    await save({ baseRevision: 0 }, true);
  }, [conflict, resume, save]);

  const discard = useCallback(() => {
    clearTimer();
    applyNote(null);
    resume();
    setSaveState('idle');
  }, [applyNote, clearTimer, resume]);

  const remove = useCallback(async () => {
    clearTimer();
    try {
      await client.notes.deleteMine(topicId);
    } catch (err) {
      // Already gone elsewhere: the outcome the student asked for.
      if (!(err instanceof Error && 'code' in err && err.code === 'NotFound')) {
        setSaveState('error');
        return;
      }
    }
    applyNote(null);
    resume();
    setSaveState('idle');
  }, [client, topicId, applyNote, clearTimer, resume]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    loadState,
    text,
    revision,
    visibility,
    moderated,
    saveState,
    conflict,
    overLimit: text.length > NOTE_BODY_MAX,
    reload,
    setText,
    setVisibility,
    loadLatest,
    keepMine,
    recreate,
    discard,
    remove,
  };
}
