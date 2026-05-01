'use client';

import { useMemo } from 'react';
import type { TopicNode } from '@web/lib/admin-topics-api';

type Props = {
  topics: TopicNode[];
  allowDrafts: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
};

export function TaskTopicPicker({ topics, allowDrafts, selected, onChange }: Props) {
  const visible = useMemo(
    () =>
      topics
        .filter((t) => !t.archived)
        .filter((t) => (allowDrafts ? true : t.status === 'published'))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [topics, allowDrafts],
  );

  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  if (visible.length === 0) {
    return <p className="text-sm text-zinc-500">No topics available to link yet.</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2" data-testid="task-topic-picker">
      {visible.map((t) => (
        <li key={t.id}>
          <label className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <input
              type="checkbox"
              checked={selectedSet.has(t.id)}
              onChange={() => toggle(t.id)}
            />
            <span className="flex-1 truncate">{t.title}</span>
            <span className="text-xs uppercase tracking-wide text-zinc-500">{t.status}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
