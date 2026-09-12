'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { notifyBillingRosterChanged } from '@web/hooks/use-delinquency-count';
import { Spinner } from '@web/components/spinner';
import type { BillingReportCurrency } from '@web/lib/admin-billing-api';
import { StudentsTab } from './students-tab';
import { LedgerTab } from './ledger-tab';
import { ReportsTab } from './reports-tab';
import { PlansTab } from './plans-tab';
import type { SignableStudent } from './sign-contract-dialog';

const TABS = ['students', 'ledger', 'reports', 'plans'] as const;
type Tab = (typeof TABS)[number];

/**
 * `/admin/billing` — the receivables console (RFC 0013 §7).
 *
 * It reports and it alerts. There is deliberately no control here that
 * suspends, locks, downgrades or restricts a student's access: no such API
 * exists, standing is resolved on the server and enforced nowhere, and an
 * affordance that implied otherwise would be a promise the backend does not
 * keep.
 */
export default function AdminBillingPage() {
  const dict = useDict();
  const d = dict.admin.billing;
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const client = useApiClient();
  // ADMIN only, matching the API's own guard — a content creator is admitted to
  // `/v1/admin/*` but not to the dojo's money.
  const isAdmin = useHasRole(ROLES.ADMIN);

  const [tab, setTab] = useState<Tab>('students');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    students: null,
    ledger: null,
    reports: null,
    plans: null,
  });

  /**
   * The console's display currency, with the exponent and symbol `formatMoney`
   * needs. Only the reports carry it — the roster and the invoice rows carry a
   * bare code — so it is resolved once from the aging report, which falls back
   * to the active currency when there is nothing outstanding to infer from.
   */
  const [currency, setCurrency] = useState<BillingReportCurrency | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);

  /**
   * The console's people. `email` and `status` ride along because the signing
   * picker needs both — it filters on name and email, and marks an account
   * that is not active — and this is the same fetch the name lookup already
   * performs. A second read of a list already in hand would be the only other
   * way to get them.
   */
  const [students, setStudents] = useState<SignableStudent[]>([]);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const aging = await client.adminBilling.reports.aging();
        if (!cancelled) {
          setCurrency(aging.currency);
          setCurrencyError(null);
        }
      } catch {
        if (!cancelled) {
          setCurrency(null);
          setCurrencyError(d.money.resolveError);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, isAdmin, d.money.resolveError]);

  // The billing API keys everything on `userId`; the names come from the users
  // directory so the console reads as people rather than as identifiers.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await client.adminUsers.list(1, 100);
        if (!cancelled) {
          setStudents(
            page.data.map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
              status: user.status,
            })),
          );
        }
      } catch {
        if (!cancelled) setStudents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, isAdmin]);

  const namesById = useMemo(
    () => new Map(students.map((student) => [student.id, student.name])),
    [students],
  );

  const nameOf = useCallback(
    (userId: string) => namesById.get(userId) ?? userId,
    [namesById],
  );

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + offset + TABS.length) % TABS.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }
  if (!isAdmin) return null;

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mb-5">
        <h1
          className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50"
          style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
        >
          {d.title}
        </h1>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.subtitle}</p>
      </div>

      {currencyError && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
        >
          {currencyError}
        </p>
      )}

      <div
        role="tablist"
        aria-label={d.tabsLabel}
        onKeyDown={onTabKeyDown}
        className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        {TABS.map((name) => (
          <button
            key={name}
            ref={(node) => {
              tabRefs.current[name] = node;
            }}
            type="button"
            role="tab"
            id={`billing-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`billing-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'border-b-2 border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {d.tabs[name]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="billing-panel-students"
        aria-labelledby="billing-tab-students"
        hidden={tab !== 'students'}
      >
        {tab === 'students' && (
          <StudentsTab
            currency={currency}
            nameOf={nameOf}
            onRosterChanged={notifyBillingRosterChanged}
            students={students}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="billing-panel-ledger"
        aria-labelledby="billing-tab-ledger"
        hidden={tab !== 'ledger'}
      >
        {tab === 'ledger' && (
          <LedgerTab currency={currency} nameOf={nameOf} students={students} />
        )}
      </div>

      <div
        role="tabpanel"
        id="billing-panel-reports"
        aria-labelledby="billing-tab-reports"
        hidden={tab !== 'reports'}
      >
        {tab === 'reports' && <ReportsTab />}
      </div>

      <div
        role="tabpanel"
        id="billing-panel-plans"
        aria-labelledby="billing-tab-plans"
        hidden={tab !== 'plans'}
      >
        {tab === 'plans' && <PlansTab currency={currency} />}
      </div>
    </main>
  );
}
