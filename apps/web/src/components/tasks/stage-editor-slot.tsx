'use client';

import type { TaskDetail } from '@web/lib/admin-tasks-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

type Props = {
  task: TaskDetail;
  topics: TopicNode[];
  onChange: () => void;
};

/**
 * Placeholder slot for the Stage Editor. The interactive editor is delivered
 * by Milestone 4 Task 08 and replaces the body of this component.
 */
export function StageEditorSlot({ task }: Props) {
  return (
    <div
      data-testid="stage-editor-slot"
      className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
    >
      <p className="font-medium">Stage editor placeholder</p>
      <p className="mt-1">
        {task.stages.length === 0
          ? 'No stages yet — the interactive editor (M4 Task 08) lands here.'
          : `${task.stages.length} stage(s) currently defined. The interactive editor (M4 Task 08) will manage them here.`}
      </p>
    </div>
  );
}
