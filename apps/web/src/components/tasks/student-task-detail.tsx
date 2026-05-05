'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { tasksApi, type PublicTaskDetail, type CheckInResult } from '@web/lib/tasks-api';

type StageState = 'checked' | 'current' | 'locked';

type StageProgress = {
  stageId: string;
  checkedInAt: string;
};

type Props = {
  task: PublicTaskDetail;
  token: string;
  initialCheckins?: StageProgress[];
};

function computeStageStates(
  stages: PublicTaskDetail['stages'],
  checkins: StageProgress[],
): Map<string, StageState> {
  const checkedIds = new Set(checkins.map((c) => c.stageId));
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const result = new Map<string, StageState>();
  let foundCurrent = false;
  for (const s of sorted) {
    if (checkedIds.has(s.id)) {
      result.set(s.id, 'checked');
    } else if (!foundCurrent) {
      result.set(s.id, 'current');
      foundCurrent = true;
    } else {
      result.set(s.id, 'locked');
    }
  }
  return result;
}

export function StudentTaskDetail({ task, token, initialCheckins = [] }: Props) {
  const [checkins, setCheckins] = useState<StageProgress[]>(initialCheckins);
  const [inflight, setInflight] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleCheckIn = useCallback(
    async (stageId: string) => {
      if (inflight) return;
      setInflight(stageId);
      const res = await tasksApi.checkIn(token, task.id, stageId);
      setInflight(null);

      if ('error' in res) {
        if (res.error.type === 'OUT_OF_ORDER') {
          const expectedStage = task.stages.find((s) => s.id === res.error.expectedStageId);
          const stageName = expectedStage ? `"${expectedStage.label}"` : 'a etapa anterior';
          showToast(`Conclua ${stageName} primeiro antes de avançar.`);
        } else {
          showToast('Não foi possível registrar o check-in. Tente novamente.');
        }
        return;
      }

      const checkIn = (res as { result: CheckInResult; created: boolean }).result.checkIn;
      setCheckins((prev) => [
        ...prev.filter((c) => c.stageId !== stageId),
        { stageId: checkIn.stageId, checkedInAt: checkIn.checkedInAt },
      ]);
    },
    [inflight, task, token, showToast],
  );

  const stageStates = computeStageStates(task.stages, checkins);
  const sortedStages = [...task.stages].sort((a, b) => a.order - b.order);
  const allDone = sortedStages.every((s) => stageStates.get(s.id) === 'checked');

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      {/* Toast */}
      {toast && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-lg px-4 py-3 text-sm font-medium"
          style={{ background: 'var(--error-bg)', color: 'var(--error)' }}
        >
          {toast}
        </div>
      )}

      <Link
        href="/tasks"
        className="text-sm transition-colors"
        style={{ color: 'var(--text2)' }}
      >
        ← Voltar para missões
      </Link>

      <header className="mt-3 mb-6">
        <h1
          className="text-3xl font-bold tracking-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: 'var(--text)' }}
        >
          {task.title}
        </h1>
        {allDone && sortedStages.length > 0 && (
          <p className="mt-2 text-sm font-medium" style={{ color: 'var(--accent3)' }}>
            ✓ Missão concluída!
          </p>
        )}
      </header>

      <section>
        <h2
          className="mb-4 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text3)' }}
        >
          Etapas
        </h2>
        {sortedStages.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Nenhuma etapa definida ainda.
          </p>
        ) : (
          <ol className="space-y-3" data-testid="stages-list" aria-label="Etapas da missão">
            {sortedStages.map((stage, idx) => {
              const state = stageStates.get(stage.id) ?? 'locked';
              const isCurrent = state === 'current';
              const isChecked = state === 'checked';
              const isLocked = state === 'locked';
              const checkin = checkins.find((c) => c.stageId === stage.id);

              return (
                <li
                  key={stage.id}
                  aria-current={isCurrent ? 'step' : undefined}
                  className="rounded-xl border p-4 transition-colors"
                  style={{
                    background: isChecked
                      ? 'oklch(0.68 0.17 150 / 0.06)'
                      : isCurrent
                      ? 'var(--bg2)'
                      : 'var(--bg2)',
                    borderColor: isChecked
                      ? 'oklch(0.68 0.17 150 / 0.3)'
                      : isCurrent
                      ? 'var(--accent)'
                      : 'var(--border)',
                    opacity: isLocked ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="shrink-0 text-xs font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text3)' }}
                        >
                          Etapa {idx + 1}
                        </span>
                        <h3
                          className="text-base font-medium"
                          style={{
                            color: 'var(--text)',
                            textDecoration: isChecked ? 'line-through' : 'none',
                          }}
                        >
                          {stage.label}
                        </h3>
                      </div>

                      {isChecked && checkin && (
                        <p
                          className="mt-1 text-xs"
                          style={{ color: 'var(--accent3)' }}
                          aria-label={`Concluído em ${new Date(checkin.checkedInAt).toLocaleDateString('pt-BR')}`}
                        >
                          ✓ Concluído em{' '}
                          {new Date(checkin.checkedInAt).toLocaleDateString('pt-BR')}
                        </p>
                      )}

                      {stage.topics.length > 0 && (
                        <ul
                          className="mt-3 flex flex-wrap gap-2"
                          aria-label={`Tópicos de ${stage.label}`}
                        >
                          {stage.topics.map((topic) => (
                            <li key={topic.id}>
                              <Link
                                href={`/catalog/${topic.id}`}
                                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors"
                                style={{
                                  background: 'var(--accent2-glow)',
                                  color: 'var(--accent2)',
                                }}
                              >
                                {topic.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Stage action */}
                    {isCurrent && (
                      <button
                        type="button"
                        onClick={() => void handleCheckIn(stage.id)}
                        disabled={inflight === stage.id}
                        aria-label={`Check-in na etapa ${stage.label}`}
                        className="shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-60"
                        style={{
                          background: 'var(--accent)',
                          color: '#0B0E17',
                          boxShadow: '0 4px 20px oklch(0.74 0.19 52 / 0.35)',
                        }}
                      >
                        {inflight === stage.id ? 'Registrando…' : 'Check-in'}
                      </button>
                    )}

                    {isLocked && (
                      <span
                        className="shrink-0 rounded-lg px-4 py-2 text-xs font-medium"
                        style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
                        title="Conclua as etapas anteriores primeiro"
                        aria-label="Etapa bloqueada. Conclua as etapas anteriores primeiro."
                      >
                        Bloqueada
                      </span>
                    )}

                    {isChecked && (
                      <span
                        className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold"
                        style={{ background: 'oklch(0.68 0.17 150 / 0.15)', color: 'var(--accent3)' }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}
