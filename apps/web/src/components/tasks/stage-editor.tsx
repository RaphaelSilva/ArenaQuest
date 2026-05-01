'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import {
  AdminTasksApiError,
  adminTasksApi,
  type TaskDetail,
  type TaskStage,
} from '@web/lib/admin-tasks-api';
import type { TopicNode } from '@web/lib/admin-topics-api';

type Props = {
  task: TaskDetail;
  topics: TopicNode[];
  onChange: () => Promise<void> | void;
};

const ERROR_HINTS: Record<string, string> = {
  STAGE_SET_MISMATCH: 'Stage list changed underneath the reorder. Try again.',
  STAGE_DELETE_FORBIDDEN: 'Stages cannot be deleted while the task is published.',
  STAGE_TOPIC_NOT_IN_TASK: 'A stage cannot link to a topic outside the task. Add it to the task first.',
};

export function StageEditor({ task, topics, onChange }: Props) {
  const { token } = useAuth();
  const [stages, setStages] = useState<TaskStage[]>(task.stages);
  const [stageTopics, setStageTopics] = useState<Record<string, string[]>>(task.stageTopicIds);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setStages(task.stages);
    setStageTopics(task.stageTopicIds);
  }, [task.stages, task.stageTopicIds]);

  const canDelete = task.status !== 'published';
  const taskTopicSet = new Set(task.taskTopicIds);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const handleApiError = (e: unknown) => {
    if (e instanceof AdminTasksApiError && ERROR_HINTS[e.code]) {
      flash(ERROR_HINTS[e.code]);
    } else {
      flash(e instanceof Error ? e.message : 'Stage operation failed');
    }
  };

  const addStage = async () => {
    if (!token) return;
    setCreating(true);
    try {
      await adminTasksApi.createStage(token, task.id, `Stage ${stages.length + 1}`);
      await onChange();
    } catch (e) {
      handleApiError(e);
    } finally {
      setCreating(false);
    }
  };

  const startRename = (stage: TaskStage) => {
    setEditingId(stage.id);
    setEditValue(stage.label);
  };

  const commitRename = async (stage: TaskStage) => {
    if (!token) return;
    const trimmed = editValue.trim();
    if (trimmed === '' || trimmed === stage.label) {
      setEditingId(null);
      return;
    }
    try {
      await adminTasksApi.updateStage(token, task.id, stage.id, trimmed);
      setEditingId(null);
      await onChange();
    } catch (e) {
      handleApiError(e);
      setEditingId(null);
    }
  };

  const move = async (stageId: string, direction: -1 | 1) => {
    if (!token) return;
    const idx = stages.findIndex((s) => s.id === stageId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= stages.length) return;

    const previous = stages;
    const next = [...stages];
    [next[idx], next[target]] = [next[target], next[idx]];
    setStages(next);

    try {
      await adminTasksApi.reorderStages(token, task.id, next.map((s) => s.id));
      await onChange();
    } catch (e) {
      setStages(previous);
      handleApiError(e);
    }
  };

  const deleteStage = async (stageId: string) => {
    if (!token) return;
    try {
      await adminTasksApi.deleteStage(token, task.id, stageId);
      await onChange();
    } catch (e) {
      handleApiError(e);
    }
  };

  const toggleStageTopic = async (stageId: string, topicId: string) => {
    if (!token) return;
    const current = stageTopics[stageId] ?? [];
    const set = new Set(current);
    if (set.has(topicId)) set.delete(topicId);
    else set.add(topicId);
    const next = Array.from(set);

    setStageTopics((prev) => ({ ...prev, [stageId]: next }));
    try {
      await adminTasksApi.setStageTopics(token, task.id, stageId, next);
      await onChange();
    } catch (e) {
      setStageTopics((prev) => ({ ...prev, [stageId]: current }));
      handleApiError(e);
    }
  };

  return (
    <div data-testid="stage-editor">
      {toast && (
        <div role="alert" className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          {toast}
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <button
          onClick={addStage}
          disabled={creating}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {creating ? 'Adding…' : 'Add Stage'}
        </button>
      </div>

      {stages.length === 0 ? (
        <p className="text-sm text-zinc-500">No stages yet.</p>
      ) : (
        <ol className="space-y-3">
          {stages.map((stage, idx) => {
            const stageTopicSet = new Set(stageTopics[stage.id] ?? []);
            return (
              <li
                key={stage.id}
                data-testid={`stage-${stage.id}`}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(stage.id, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${stage.label} up`}
                      className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-30"
                    >▲</button>
                    <button
                      onClick={() => move(stage.id, 1)}
                      disabled={idx === stages.length - 1}
                      aria-label={`Move ${stage.label} down`}
                      className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-30"
                    >▼</button>
                  </div>

                  {editingId === stage.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitRename(stage)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  ) : (
                    <button
                      onClick={() => startRename(stage)}
                      className="flex-1 text-left text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {stage.label}
                    </button>
                  )}

                  <button
                    onClick={() => deleteStage(stage.id)}
                    disabled={!canDelete}
                    title={canDelete ? 'Delete stage' : 'Cannot delete a stage while the task is published'}
                    aria-label={`Delete ${stage.label}`}
                    className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                </div>

                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Topics for this stage</p>
                  {topics.length === 0 ? (
                    <p className="text-xs text-zinc-500">No topics in the catalogue.</p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
                      {topics
                        .filter((t) => !t.archived)
                        .map((t) => {
                          const inTask = taskTopicSet.has(t.id);
                          const checked = stageTopicSet.has(t.id);
                          return (
                            <li key={t.id}>
                              <label
                                title={inTask ? '' : 'Add this topic to the task first'}
                                className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                                  inTask
                                    ? 'border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
                                    : 'border-dashed border-zinc-200 opacity-50 dark:border-zinc-800'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!inTask}
                                  onChange={() => toggleStageTopic(stage.id, t.id)}
                                />
                                <span className="flex-1 truncate">{t.title}</span>
                              </label>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
