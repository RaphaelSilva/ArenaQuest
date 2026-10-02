'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { slugify } from '@arenaquest/shared/domain/tags/slugify';
import { useDict } from '@web/context/dict-context';
import type { AdminTag } from '@web/lib/admin-tags-api';

/** A chip in the combobox: a tag name, and whether it does not exist yet. */
export type TagChipValue = { name: string; isNew: boolean };

/** Mirrors the API limits on `tags` (admin-topics.controller.ts). */
export const TAG_NAME_MAX_LENGTH = 40;
export const TAGS_MAX_COUNT = 20;

/** Debounce before querying suggestions, as the catalog search. */
export const TAG_SEARCH_DEBOUNCE_MS = 200;

type TagComboboxProps = {
  id?: string;
  value: TagChipValue[];
  onChange: (next: TagChipValue[]) => void;
  /** Suggestion lookup; the page passes `(q) => client.adminTags.list({ q, limit: 10 })`. */
  searchTags: (q: string) => Promise<AdminTag[]>;
};

/**
 * Tag a topic by name. Typing lists matching tags (debounced), picking one adds
 * it as a chip, Enter on a name with no match adds it as a new chip. Chips are
 * de-duplicated by slug, so `CHUDAN` next to `Chūdan` is not added twice.
 * Follows the ARIA combobox pattern (list autocomplete).
 */
export function TagCombobox({ id, value, onChange, searchTags }: TagComboboxProps) {
  const dict = useDict();
  const d = dict.admin.topics.detail;

  const generatedId = useId();
  const inputId = id ?? `tag-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const optionId = (i: number) => `${inputId}-option-${i}`;

  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<AdminTag[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Sequence counter: only the response to the latest request may land.
  const seqRef = useRef(0);

  const chipSlugs = useMemo(() => new Set(value.map((t) => slugify(t.name))), [value]);
  const visible = useMemo(
    () => suggestions.filter((s) => !chipSlugs.has(s.slug)),
    [suggestions, chipSlugs],
  );

  useEffect(() => {
    const q = input.trim();
    const seq = ++seqRef.current;
    // Empty input: no request (the list is closed by `handleInputChange`).
    if (!q) return;
    const timer = setTimeout(() => {
      searchTags(q)
        .then((tags) => {
          if (seq !== seqRef.current) return;
          setSuggestions(tags);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setSuggestions([]);
          setActiveIndex(-1);
          setOpen(true);
        });
    }, TAG_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, searchTags]);

  const atMax = value.length >= TAGS_MAX_COUNT;

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function addTag(rawName: string, isNew: boolean) {
    const name = rawName.trim().slice(0, TAG_NAME_MAX_LENGTH);
    const slug = slugify(name);
    if (!slug || chipSlugs.has(slug) || atMax) return;
    onChange([...value, { name, isNew }]);
    // Invalidate any in-flight lookup for the text just consumed.
    seqRef.current++;
    setInput('');
    setSuggestions([]);
    close();
  }

  function handleInputChange(next: string) {
    setInput(next);
    if (!next.trim()) {
      setSuggestions([]);
      close();
    }
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown': {
        if (visible.length === 0) return;
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (i + 1) % visible.length);
        return;
      }
      case 'ArrowUp': {
        if (visible.length === 0) return;
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (i <= 0 ? visible.length - 1 : i - 1));
        return;
      }
      case 'Enter': {
        // Never submit the surrounding form from the tag input.
        e.preventDefault();
        if (open && activeIndex >= 0 && visible[activeIndex]) {
          addTag(visible[activeIndex].name, false);
          return;
        }
        const typed = input.trim();
        if (!typed) return;
        const typedSlug = slugify(typed);
        const exact = suggestions.find((s) => s.slug === typedSlug);
        if (exact) addTag(exact.name, false);
        else addTag(typed, true);
        return;
      }
      case 'Backspace': {
        if (input === '' && value.length > 0) {
          e.preventDefault();
          removeAt(value.length - 1);
        }
        return;
      }
      case 'Escape': {
        if (open) {
          e.preventDefault();
          close();
        }
        return;
      }
    }
  }

  const typing = open && input.trim() !== '';
  const showList = typing && visible.length > 0;
  const activeDescendant = showList && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <div className="relative">
      <div className="flex w-full flex-wrap items-center gap-2 rounded border border-zinc-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800">
        {value.map((tag, i) => (
          <span
            key={`${slugify(tag.name)}-${i}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
          >
            <span className="truncate">{tag.name}</span>
            {tag.isNew && (
              <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
                {d.tagNewMarker}
              </span>
            )}
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={d.tagRemoveAriaLabel(tag.name)}
              className="flex-shrink-0 leading-none text-zinc-500 hover:text-indigo-600 dark:text-zinc-400"
            >
              <span aria-hidden>×</span>
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          autoComplete="off"
          maxLength={TAG_NAME_MAX_LENGTH}
          disabled={atMax}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={close}
          placeholder={d.tagsPlaceholder}
          className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none dark:text-zinc-50"
        />
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-label={d.tagSuggestionsLabel}
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {visible.map((tag, i) => (
          <li
            key={tag.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            // Keep focus on the input so the click lands before blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => addTag(tag.name, false)}
            onMouseEnter={() => setActiveIndex(i)}
            className={`cursor-pointer px-3 py-1.5 text-zinc-800 dark:text-zinc-100 ${
              i === activeIndex ? 'bg-indigo-50 dark:bg-indigo-950' : ''
            }`}
          >
            {tag.name}
          </li>
        ))}
      </ul>
      {typing && visible.length === 0 && (
        <p className="absolute z-20 mt-1 w-full rounded border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {d.tagNoSuggestions}
        </p>
      )}
    </div>
  );
}
