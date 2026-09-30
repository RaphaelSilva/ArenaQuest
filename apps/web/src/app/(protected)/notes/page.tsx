'use client';

import { useDict } from '@web/context/dict-context';
import { MyNotesList } from '@web/components/catalog/notes/MyNotesList';

/** "My notes": every note the student wrote, across topics. Read-only. */
export default function MyNotesPage() {
  const dict = useDict();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-1 text-2xl font-semibold" style={{ color: 'var(--aq-text)' }}>
          {dict.notes.myNotes.title}
        </h1>
        <p className="mb-6 text-[13px]" style={{ color: 'var(--aq-text2)' }}>
          {dict.notes.myNotes.subtitle}
        </p>
        <MyNotesList />
      </div>
    </main>
  );
}
