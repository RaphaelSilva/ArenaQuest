'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@web/components/design-system';
import type {
  Mission,
  MissionParticipant,
  MissionReconcileReport,
  MissionRequirement,
} from '@web/lib/admin-gamification-api';
import { ParticipantRow } from './ParticipantRow';
import { deriveStepChips } from './participant-chips';
import { cardClass, cardStyle, errorStyle, eyebrowClass, eyebrowStyle, hintClass, hintStyle } from './form-styles';

type Props = {
  missionId: string;
  mission: Mission;
  requirements: MissionRequirement[];
  /** Admin only: the server refuses the reconcile route to anyone else anyway. */
  canReconcile: boolean;
};

/**
 * The editor page's Participants tab (RFC 0022 §7): one row per enrollment, cursor
 * pages appended by *Load more*, and — for an admin — *Reconcile now*.
 */
export function ParticipantsPanel({ missionId, mission, requirements, canReconcile }: Props) {
  const d = useDict().admin.missions.participants;
  const client = useApiClient();

  const [rows, setRows] = useState<MissionParticipant[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [report, setReport] = useState<MissionReconcileReport | null>(null);
  const [reconcileError, setReconcileError] = useState('');
  // A newer first-page load (e.g. after a reconcile) makes older responses stale.
  const generation = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError('');
    setLoadMoreError('');
    try {
      const page = await client.adminGamification.missions.listParticipants(missionId);
      if (current !== generation.current) return;
      setRows(page.data);
      setNextCursor(page.nextCursor);
    } catch {
      if (current !== generation.current) return;
      setLoadError(d.loadError);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [client, d, missionId]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await client.adminGamification.missions.listParticipants(missionId, nextCursor);
      if (current !== generation.current) return;
      setRows((existing) => [...existing, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch {
      if (current === generation.current) setLoadMoreError(d.loadMoreError);
    } finally {
      setLoadingMore(false);
    }
  };

  const reconcile = async () => {
    if (!canReconcile || reconciling) return;
    setReconciling(true);
    setReport(null);
    setReconcileError('');
    try {
      setReport(await client.adminGamification.missions.reconcile(missionId));
      await loadFirstPage();
    } catch {
      setReconcileError(d.reconcileError);
    } finally {
      setReconciling(false);
    }
  };

  const chipsByUser = useMemo(
    () => new Map(rows.map((row) => [row.userId, deriveStepChips(requirements, row.steps, mission.mode)])),
    [rows, requirements, mission.mode],
  );

  return (
    <section className={`${cardClass} space-y-4`} style={cardStyle} data-testid="participants-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className={eyebrowClass} style={eyebrowStyle}>
          {d.heading}
        </h2>
        {canReconcile && (
          <div className="flex flex-col items-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void reconcile()}
              disabled={reconciling}
              isLoading={reconciling}
            >
              {reconciling ? d.reconciling : d.reconcileButton}
            </Button>
            <p className={hintClass} style={hintStyle}>
              {d.reconcileHint}
            </p>
          </div>
        )}
      </div>

      {report && (
        <p role="status" data-testid="reconcile-result" className="text-sm" style={{ color: 'var(--accent3)' }}>
          {d.reconcileResult(
            report.enrollmentsEvaluated,
            report.stepsClosed,
            report.missionsClosed,
            report.enrollmentsCreated,
            report.failed,
          )}
        </p>
      )}
      {reconcileError && (
        <p role="alert" className="text-sm" style={errorStyle}>
          {reconcileError}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm" role="status" style={{ color: 'var(--text3)' }}>
          <Spinner className="h-4 w-4" />
          <span>{d.loading}</span>
        </div>
      ) : loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm" style={errorStyle}>
            {loadError}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadFirstPage()}>
            {d.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm" style={{ color: 'var(--text2)' }} data-testid="participants-empty">
          {d.empty}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow isHoverable={false}>
                <TableCell isHeader>{d.columns.student}</TableCell>
                <TableCell isHeader>{d.columns.source}</TableCell>
                <TableCell isHeader>{d.columns.joined}</TableCell>
                <TableCell isHeader>{d.columns.steps}</TableCell>
                <TableCell isHeader>{d.columns.completion}</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <ParticipantRow key={row.userId} participant={row} chips={chipsByUser.get(row.userId) ?? []} />
              ))}
            </TableBody>
          </Table>

          {loadMoreError && (
            <p role="alert" className="text-sm" style={errorStyle}>
              {loadMoreError}
            </p>
          )}
          {nextCursor && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                isLoading={loadingMore}
              >
                {loadingMore ? d.loadingMore : d.loadMore}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
