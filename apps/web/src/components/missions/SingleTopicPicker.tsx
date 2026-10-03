'use client';

import { useMemo } from 'react';
import { useDict } from '@web/context/dict-context';
import { TaskTopicPicker } from '@web/components/tasks/task-topic-picker';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { hintClass, hintStyle } from './form-styles';

type Props = {
  topics: TopicNode[];
  /** The picked topic id, or `''`. */
  value: string;
  onChange: (topicId: string) => void;
  disabled?: boolean;
};

/**
 * One topic out of the published, non-archived ones — a thin single-select
 * wrapper over the multi-select `TaskTopicPicker`: `selected = [id]`, and a
 * change keeps the newly ticked id (unticking the current one clears it).
 * Read-only, it shows the picked topic and nothing to click.
 */
export function SingleTopicPicker({ topics, value, onChange, disabled = false }: Props) {
  const d = useDict().admin.missions.requirements;
  const title = useMemo(() => topics.find((t) => t.id === value)?.title, [topics, value]);

  const handleChange = (ids: string[]) => {
    const picked = ids.find((id) => id !== value);
    onChange(picked ?? (ids.includes(value) ? value : ''));
  };

  return (
    <div className="space-y-2">
      <p className={hintClass} style={hintStyle}>
        {value ? d.topicSelected(title ?? d.topicUnknown) : d.topicNone}
      </p>
      {!disabled && (
        <div className="max-h-56 overflow-y-auto pr-1">
          <TaskTopicPicker
            topics={topics}
            allowDrafts={false}
            selected={value ? [value] : []}
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  );
}
