'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useDict } from '@web/context/dict-context';
import { useHasRole } from '@web/hooks/use-auth';
import { MyNoteEditor } from './MyNoteEditor';
import { ClassNotesList } from './ClassNotesList';
import { StaffNoteActions, staffActionFor } from './StaffNoteActions';
import { StaffNoteBadges } from './StaffNoteBadges';

type NotesTab = 'mine' | 'class';

/**
 * The *Class notes* list, decorated for the staff (admin and content creator)
 * with visibility badges and the moderation actions. A tutor is not staff.
 * The gate is a UI affordance only — the API rejects a non-staff call with 403.
 */
function DefaultClassNotes({ topicId }: { topicId: string }) {
  const isStaff = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  if (!isStaff) return <ClassNotesList topicId={topicId} />;
  return (
    <ClassNotesList
      topicId={topicId}
      renderBadges={(note) => <StaffNoteBadges note={note} />}
      renderActions={(note, _reload, update) =>
        // Moderation is for other people's notes; the staff's own is edited from *My note*.
        !note.isMine && staffActionFor(note) ? <StaffNoteActions note={note} onChange={update} /> : undefined
      }
    />
  );
}

const TABS: readonly NotesTab[] = ['mine', 'class'];

type NotesPanelProps = {
  topicId: string;
  /**
   * Content of the *Class notes* tab. Omitted, the tab shows the topic's
   * class notes list.
   */
  classNotes?: ReactNode;
  /** Autosave debounce override, for tests. */
  debounceMs?: number;
};

/**
 * The Notes panel on a topic page: *My note* (the caller's own editor) and
 * *Class notes*. The panel only ever edits the caller's own note.
 */
export function NotesPanel({ topicId, classNotes, debounceMs }: NotesPanelProps) {
  const dict = useDict();
  const baseId = useId();
  const [active, setActive] = useState<NotesTab>('mine');
  const tabRefs = useRef<Record<NotesTab, HTMLButtonElement | null>>({ mine: null, class: null });

  const labels: Record<NotesTab, string> = {
    mine: dict.notes.tabMine,
    class: dict.notes.tabClass,
  };

  const focusTab = (tab: NotesTab) => {
    setActive(tab);
    tabRefs.current[tab]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(active);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(TABS[(index + 1) % TABS.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(TABS[(index - 1 + TABS.length) % TABS.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(TABS[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(TABS[TABS.length - 1]);
    }
  };

  const tabId = (tab: NotesTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: NotesTab) => `${baseId}-panel-${tab}`;

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.notes.title}
      </h2>

      <div
        role="tablist"
        aria-label={dict.notes.tabsLabel}
        onKeyDown={onKeyDown}
        className="mb-4 flex gap-1 border-b"
        style={{ borderColor: 'var(--aq-border)' }}
      >
        {TABS.map((tab) => {
          const selected = tab === active;
          return (
            <button
              key={tab}
              ref={(el) => { tabRefs.current[tab] = el; }}
              id={tabId(tab)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab)}
              className="-mb-px cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors duration-150"
              style={{
                borderColor: selected ? 'var(--aq-accent)' : 'transparent',
                color: selected ? 'var(--aq-accent)' : 'var(--aq-text2)',
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {TABS.map((tab) => (
        <div
          key={tab}
          id={panelId(tab)}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          hidden={tab !== active}
          tabIndex={0}
        >
          {/* The editor stays mounted while hidden so a pending autosave is not lost on a tab switch. */}
          {tab === 'mine' && <MyNoteEditor topicId={topicId} debounceMs={debounceMs} />}
          {tab === 'class' && tab === active && (classNotes ?? <DefaultClassNotes topicId={topicId} />)}
        </div>
      ))}
    </section>
  );
}
